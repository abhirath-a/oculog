Pod::Spec.new do |s|
  s.name = 'OculogPrescriptionOCR'
  s.version = '1.0.0'
  s.summary = 'Device-only Apple Vision prescription text extraction'
  s.description = 'Local image recognition and VisionKit document camera. No network services.'
  s.license = { :type => 'MIT' }
  s.author = 'Oculog'
  s.homepage = 'https://github.com/oculog/oculog'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'VisionKit', 'ImageIO', 'UIKit', 'AVFoundation', 'UniformTypeIdentifiers'
  s.swift_version = '5.9'
  s.source_files = '**/*.swift'
end
