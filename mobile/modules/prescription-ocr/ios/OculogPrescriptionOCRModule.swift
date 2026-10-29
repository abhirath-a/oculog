import ExpoModulesCore
import AVFoundation
import ImageIO
import UniformTypeIdentifiers
import UIKit
import Vision
import VisionKit

// Swift 5.9 language mode, matching Expo's callback/queue APIs. No Swift 6.4 syntax.
private let recognitionQueue = DispatchQueue(label: "oculog.prescription-ocr", qos: .userInitiated)

private enum OCRFailure: String, Error {
  case cancelled = "OCR_CANCELLED"
  case cleanup = "OCR_CLEANUP_FAILED"
  case invalidURI = "OCR_INVALID_URI"
  case tooLarge = "OCR_INPUT_TOO_LARGE"
  case unsupportedImage = "OCR_UNSUPPORTED_IMAGE"
  case tooManyPages = "OCR_TOO_MANY_PAGES"
  case failed = "OCR_FAILED"
  case resultTooLarge = "OCR_RESULT_TOO_LARGE"
}

private struct TextLine: Sendable {
  let text: String
  let confidence: Float
  let x: Double
  let y: Double
  let width: Double
  let height: Double
  let page: Int

  var bridge: [String: Any] {
    ["text": text, "confidence": confidence, "x": x, "y": y,
     "width": width, "height": height, "page": page]
  }
}

private enum Recognition {
  static let maxBytes = 20 * 1024 * 1024
  static let maxPixels = 48_000_000
  static let maxEdge = 16_000
  static let decodeEdge = 3200
  static let maxLines = 600
  static let maxTextBytes = 60_000

  static func localURL(_ uri: String) throws -> URL {
    guard uri.utf8.count <= 4096, let url = URL(string: uri), url.isFileURL,
      url.host == nil || url.host == "" || url.host == "localhost",
      url.query == nil, url.fragment == nil,
      !url.pathComponents.contains("..") else { throw OCRFailure.invalidURI }
    let resolved = url.standardizedFileURL.resolvingSymlinksInPath()
    let roots = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)
      + [FileManager.default.temporaryDirectory]
    guard roots.contains(where: {
      let root = $0.standardizedFileURL.resolvingSymlinksInPath().path
      let lexicalRoot = $0.standardizedFileURL.path
      let lexicalPath = url.standardizedFileURL.path
      return (lexicalPath.hasPrefix(lexicalRoot + "/") || lexicalPath.hasPrefix(root + "/"))
        && resolved.path.hasPrefix(root + "/")
    }) else { throw OCRFailure.invalidURI }
    let values = try resolved.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    guard values.isRegularFile == true else { throw OCRFailure.invalidURI }
    guard let bytes = values.fileSize, bytes > 0, bytes <= maxBytes else { throw OCRFailure.tooLarge }
    return resolved
  }

  static func decode(_ uri: String) throws -> CGImage {
    let url = try localURL(uri)
    guard let source = CGImageSourceCreateWithURL(url as CFURL,
      [kCGImageSourceShouldCache: false] as CFDictionary),
      let type = CGImageSourceGetType(source) as String?,
      [UTType.jpeg.identifier, UTType.png.identifier, UTType.heic.identifier,
       UTType.heif.identifier].contains(type),
      CGImageSourceGetCount(source) == 1,
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int
    else { throw OCRFailure.unsupportedImage }
    try checkDimensions(width, height)
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: decodeEdge,
      kCGImageSourceShouldCacheImmediately: true
    ] as CFDictionary) else { throw OCRFailure.unsupportedImage }
    return image
  }

  static func checkDimensions(_ width: Int, _ height: Int) throws {
    guard width > 0, height > 0, width <= maxEdge, height <= maxEdge,
      width <= maxPixels / height else { throw OCRFailure.tooLarge }
  }

  static func lines(_ image: CGImage, page: Int, operation: OCROperation,
                    orientation: CGImagePropertyOrientation = .up) throws -> [TextLine] {
    try operation.checkCancellation()
    let request = VNRecognizeTextRequest()
    try operation.register(request)
    defer { operation.clearRequest() }
    request.recognitionLevel = .accurate
    // Do not autocorrect clinical abbreviations or signed numeric text.
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: image, orientation: orientation).perform([request])
    try operation.checkCancellation()
    let observations = request.results ?? []
    guard observations.count <= maxLines else { throw OCRFailure.resultTooLarge }
    var output: [TextLine] = []
    var bytes = 0
    for observation in observations {
      guard let candidate = observation.topCandidates(1).first else { continue }
      let text = candidate.string
      bytes += text.utf8.count
      guard text.utf8.count <= 512, bytes <= maxTextBytes else { throw OCRFailure.resultTooLarge }
      let box = observation.boundingBox
      output.append(TextLine(text: text, confidence: candidate.confidence,
        x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height, page: page))
    }
    return output
  }

  static func bridge(_ lines: [TextLine], pages: Int) throws -> [String: Any] {
    guard lines.count <= maxLines,
      lines.reduce(0, { $0 + $1.text.utf8.count }) <= maxTextBytes
    else { throw OCRFailure.resultTooLarge }
    return ["lines": lines.map(\.bridge), "pageCount": pages]
  }

  static func reject(_ promise: Promise, _ error: Error) {
    let code = (error as? OCRFailure)?.rawValue ?? OCRFailure.failed.rawValue
    // Never forward underlying errors: they can contain private file URLs.
    promise.reject(code, "The image could not be read safely. Try another image or enter values manually.")
  }
}

// Promise and cancellation are synchronized across main/delegate and recognition queues.
// The module retains this object until worker cleanup completes, not just camera dismissal.
private final class OCROperation {
  private let lock = NSLock()
  private var promise: Promise?
  private var cancelled = false
  private var request: VNRecognizeTextRequest?

  init(_ promise: Promise) { self.promise = promise }

  func checkCancellation() throws {
    lock.lock()
    defer { lock.unlock() }
    if cancelled { throw OCRFailure.cancelled }
  }

  func register(_ request: VNRecognizeTextRequest) throws {
    lock.lock()
    defer { lock.unlock() }
    if cancelled { throw OCRFailure.cancelled }
    self.request = request
  }

  func clearRequest() {
    lock.lock()
    request = nil
    lock.unlock()
  }

  private func takePromise() -> Promise? {
    lock.lock()
    defer { lock.unlock() }
    let pending = promise
    promise = nil
    return pending
  }

  func resolve(_ value: Any?) { takePromise()?.resolve(value) }
  func reject(_ error: Error) {
    if let pending = takePromise() { Recognition.reject(pending, error) }
  }
  func rejectCode(_ code: String) {
    takePromise()?.reject(code, "Image reading is unavailable or was cancelled. Enter values manually.")
  }

  func cancel() {
    lock.lock()
    cancelled = true
    request?.cancel()
    let pending = promise
    promise = nil
    lock.unlock()
    pending?.reject("OCR_CANCELLED", "Scanning was cancelled.")
  }
}

// All file ownership and active-copy bookkeeping runs on the serial recognition queue.
private enum ImportStorage {
  static var active = Set<URL>()

  static func directory() throws -> URL {
    let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .standardizedFileURL.resolvingSymlinksInPath()
    let directory = cache.appendingPathComponent("oculog-prescription-ocr-v1", isDirectory: true)
    let values = try? directory.resourceValues(forKeys: [.isSymbolicLinkKey])
    guard values?.isSymbolicLink != true,
      directory.resolvingSymlinksInPath().deletingLastPathComponent().path == cache.path
    else { throw OCRFailure.invalidURI }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
      attributes: [.protectionKey: FileProtectionType.complete])
    return directory
  }

  static func cleanup() throws {
    let directory = try directory()
    for file in try FileManager.default.contentsOfDirectory(at: directory,
      includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey]) {
      // Accept previous JS-owned names as well as new UUID names for crash recovery.
      guard file.lastPathComponent.range(of: "^image-([0-9]+-[0-9]+|[A-Fa-f0-9-]{36})\\.img$",
        options: .regularExpression) != nil, !active.contains(file) else { continue }
      let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
      guard values.isRegularFile == true, values.isSymbolicLink != true,
        file.resolvingSymlinksInPath().deletingLastPathComponent().path == directory.path
      else { continue }
      try FileManager.default.removeItem(at: file)
    }
  }

  static func recognize(_ source: URL, operation: OCROperation) throws -> [String: Any] {
    // Open-in-place: the provider owns its source; never remove or move it.
    let scoped = source.startAccessingSecurityScopedResource()
    defer { if scoped { source.stopAccessingSecurityScopedResource() } }
    try operation.checkCancellation()
    guard source.isFileURL else { throw OCRFailure.invalidURI }
    let values = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
    guard values.isRegularFile == true, values.isSymbolicLink != true else { throw OCRFailure.invalidURI }
    // Reject reported oversize before creating any app-owned image copy.
    if let size = values.fileSize, size < 0 || size > Recognition.maxBytes { throw OCRFailure.tooLarge }
    try cleanup()
    let destination = try directory().appendingPathComponent("image-\(UUID().uuidString).img")
    active.insert(destination)
    defer { active.remove(destination) }
    let result: Result<[String: Any], Error>
    do {
      // Protection is applied at creation, before the first byte of PHI is written.
      guard FileManager.default.createFile(atPath: destination.path, contents: nil,
        attributes: [.protectionKey: FileProtectionType.complete]) else { throw OCRFailure.failed }
      try copyBounded(source, to: destination, operation: operation)
      result = .success(try autoreleasepool {
        try operation.checkCancellation()
        return try Recognition.bridge(Recognition.lines(Recognition.decode(destination.absoluteString),
          page: 0, operation: operation), pages: 1)
      })
    } catch { result = .failure(error) }
    // Finally-style cleanup before either result or error can settle the promise.
    do {
      if FileManager.default.fileExists(atPath: destination.path) {
        try FileManager.default.removeItem(at: destination)
      }
    } catch { throw OCRFailure.cleanup }
    try operation.checkCancellation()
    return try result.get()
  }

  private static func copyBounded(_ source: URL, to destination: URL,
                                  operation: OCROperation) throws {
    guard let input = InputStream(url: source), let output = OutputStream(url: destination, append: false)
    else { throw OCRFailure.failed }
    input.open()
    output.open()
    defer { input.close(); output.close() }
    var buffer = [UInt8](repeating: 0, count: 64 * 1024)
    var total = 0
    while true {
      try operation.checkCancellation()
      let count = input.read(&buffer, maxLength: buffer.count)
      guard count >= 0 else { throw OCRFailure.failed }
      if count == 0 { break }
      guard count <= Recognition.maxBytes - total else { throw OCRFailure.tooLarge }
      total += count
      try buffer.withUnsafeBufferPointer { bytes in
        guard let base = bytes.baseAddress else { throw OCRFailure.failed }
        var offset = 0
        while offset < count {
          try operation.checkCancellation()
          let written = output.write(base.advanced(by: offset), maxLength: count - offset)
          guard written > 0 else { throw OCRFailure.failed }
          offset += written
        }
      }
    }
    guard total > 0 else { throw OCRFailure.unsupportedImage }
  }
}

@MainActor
private final class CaptureSession: NSObject, VNDocumentCameraViewControllerDelegate,
  UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  let operation: OCROperation
  private let onFinish: () -> Void
  private weak var controller: UIViewController?
  private var processing = false

  init(operation: OCROperation, onFinish: @escaping () -> Void) {
    self.operation = operation
    self.onFinish = onFinish
  }

  static var supported: Bool {
#if targetEnvironment(simulator)
    return false
#else
    return VNDocumentCameraViewController.isSupported
#endif
  }

  func present(from presenter: UIViewController, importing: Bool) {
    guard presenter.viewIfLoaded?.window != nil, !presenter.isBeingDismissed,
      presenter.presentedViewController == nil else { return fail("OCR_PRESENTATION_FAILED") }
    let presented: UIViewController
    if importing {
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.jpeg, .png, .heic, .heif], asCopy: false)
      picker.allowsMultipleSelection = false
      picker.delegate = self
      presented = picker
    } else {
      guard Self.supported else { return fail("OCR_SCANNER_UNAVAILABLE") }
      guard AVCaptureDevice.authorizationStatus(for: .video) != .denied,
        AVCaptureDevice.authorizationStatus(for: .video) != .restricted
      else { return fail("OCR_CAMERA_PERMISSION") }
      guard Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription") is String
      else { return fail("OCR_CAMERA_CONFIGURATION") }
      let camera = VNDocumentCameraViewController()
      camera.delegate = self
      presented = camera
    }
    controller = presented
    presenter.present(presented, animated: true)
    presented.presentationController?.delegate = self
  }

  func dismiss() {
    (controller as? VNDocumentCameraViewController)?.delegate = nil
    (controller as? UIDocumentPickerViewController)?.delegate = nil
    controller?.presentationController?.delegate = nil
    controller?.dismiss(animated: true)
  }

  private func fail(_ code: String) {
    operation.rejectCode(code)
    dismiss()
    onFinish()
  }

  func invalidate() {
    operation.cancel()
    dismiss()
    // A queued/running worker retains the operation until its cleanup finishes.
    if !processing { onFinish() }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    guard !processing else { return }
    operation.resolve(nil)
    dismiss()
    onFinish()
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    if !processing { fail("OCR_CANCELLED") }
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard !processing else { return }
    guard urls.count == 1, let source = urls.first else { return fail("OCR_UNSUPPORTED_IMAGE") }
    processing = true
    dismiss()
    let operation = self.operation
    let finish = onFinish
    recognitionQueue.async {
      defer { DispatchQueue.main.async { finish() } }
      do { operation.resolve(try ImportStorage.recognize(source, operation: operation)) }
      catch { operation.reject(error) }
    }
  }

  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    if !processing { fail("OCR_CANCELLED") }
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
    if !processing { fail("OCR_CAMERA_FAILED") }
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController,
                                    didFinishWith scan: VNDocumentCameraScan) {
    guard !processing else { return }
    guard scan.pageCount > 0, scan.pageCount <= 3 else { return fail("OCR_TOO_MANY_PAGES") }
    processing = true
    dismiss()
    let operation = self.operation
    let finish = onFinish
    recognitionQueue.async {
      defer { DispatchQueue.main.async { finish() } }
      do {
        var all: [TextLine] = []
        for page in 0..<scan.pageCount {
          try operation.checkCancellation()
          let pageLines = try autoreleasepool { () throws -> [TextLine] in
            let image = scan.imageOfPage(at: page)
            guard let cgImage = image.cgImage else { throw OCRFailure.unsupportedImage }
            try Recognition.checkDimensions(cgImage.width, cgImage.height)
            guard cgImage.bytesPerRow <= (192 * 1024 * 1024) / cgImage.height else { throw OCRFailure.tooLarge }
            let scale = min(1, CGFloat(Recognition.decodeEdge) / max(image.size.width, image.size.height))
            let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
              image.draw(in: CGRect(origin: .zero, size: size))
            }
            guard let bounded = resized.cgImage else { throw OCRFailure.unsupportedImage }
            return try Recognition.lines(bounded, page: page, operation: operation)
          }
          all.append(contentsOf: pageLines)
          guard all.count <= Recognition.maxLines else { throw OCRFailure.resultTooLarge }
        }
        try operation.checkCancellation()
        operation.resolve(try Recognition.bridge(all, pages: scan.pageCount))
      } catch { operation.reject(error) }
    }
  }
}

public final class OculogPrescriptionOCRModule: Module {
  // All module state is main-queue confined; all operation state is lock-protected.
  private var operation: OCROperation?
  private var session: CaptureSession?
  private var destroyed = false

  private func finish(_ completed: OCROperation) {
    if operation === completed { session = nil; operation = nil }
  }

  private func begin(_ promise: Promise) -> OCROperation? {
    guard !destroyed else {
      promise.reject("OCR_CANCELLED", "Scanning was cancelled.")
      return nil
    }
    guard operation == nil else {
      promise.reject("OCR_BUSY", "Image reading is already active.")
      return nil
    }
    let pending = OCROperation(promise)
    operation = pending
    return pending
  }

  public func definition() -> ModuleDefinition {
    Name("OculogPrescriptionOCR")

    Function("scannerAvailable") { () -> Bool in
      if Thread.isMainThread { return MainActor.assumeIsolated { CaptureSession.supported } }
      return DispatchQueue.main.sync { CaptureSession.supported }
    }

    AsyncFunction("cleanupPrescriptionImages") { (promise: Promise) in
      do { try ImportStorage.cleanup(); promise.resolve(nil) }
      catch { promise.reject("OCR_CLEANUP_FAILED", "Temporary image cleanup failed.") }
    }.runOnQueue(recognitionQueue)

    AsyncFunction("recognizePrescriptionImage") { (uri: String, promise: Promise) in
      guard let pending = self.begin(promise) else { return }
      recognitionQueue.async {
        defer { DispatchQueue.main.async { self.finish(pending) } }
        do {
          let result = try autoreleasepool {
            try pending.checkCancellation()
            return try Recognition.bridge(Recognition.lines(Recognition.decode(uri), page: 0,
              operation: pending), pages: 1)
          }
          try pending.checkCancellation()
          pending.resolve(result)
        } catch { pending.reject(error) }
      }
    }.runOnQueue(.main)

    AsyncFunction("importPrescriptionImage") { (promise: Promise) in
      MainActor.assumeIsolated { self.present(promise, importing: true) }
    }.runOnQueue(.main)

    AsyncFunction("scanPrescription") { (promise: Promise) in
      MainActor.assumeIsolated { self.present(promise, importing: false) }
    }.runOnQueue(.main)

    OnDestroy {
      // Capture strongly: teardown must invalidate even if module ownership is released.
      let invalidate = {
        self.destroyed = true
        self.operation?.cancel()
        MainActor.assumeIsolated { self.session?.invalidate() }
      }
      if Thread.isMainThread { invalidate() }
      else { DispatchQueue.main.sync(execute: invalidate) }
    }
  }

  @MainActor
  private func present(_ promise: Promise, importing: Bool) {
    guard let pending = begin(promise) else { return }
    guard let presenter = appContext?.utilities?.currentViewController() else {
      pending.rejectCode("OCR_PRESENTATION_FAILED")
      finish(pending)
      return
    }
    let capture = CaptureSession(operation: pending) { [weak self] in self?.finish(pending) }
    session = capture
    capture.present(from: presenter, importing: importing)
  }
}
