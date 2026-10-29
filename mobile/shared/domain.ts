/** Shared domain contracts. Record IDs and RFC3339 UTC instants are strings.
 * JSON uses camelCase field names exactly as declared. No Date objects on the wire.
 */
export type Id = string;
export type Instant = string;
export type LocalDate = string; // YYYY-MM-DD
export type LocalTime = string; // HH:mm
export type TimeZone = string; // IANA identifier
export type Eye = "left" | "right";
export type LensKind = "daily" | "reusable";
export type WearPolicy = "daytime" | "prescribed_overnight";
/** Advisory violations of reported/estimated bounds, never deadline extensions. */
export type PolicyWarning =
	| "daytime_midnight"
	| "overnight_limit"
	| "lens_deadline";
export type LensStatus = "active" | "disposed";
export type SessionSource = "manual" | "routine";
export type SessionState = "open" | "complete";
export type ReviewState =
	| "not_required"
	| "pending"
	| "confirmed"
	| "corrected";
export type StockReason =
	| "purchase"
	| "opening"
	| "adjustment"
	| "discard_unopened";
export type DisposalReason =
	| "deadline"
	| "daily_removed"
	| "comfort"
	| "damage"
	| "lost"
	| "other";
export type ProblemKind =
	| "dryness"
	| "irritation"
	| "redness"
	| "pain"
	| "blur"
	| "other";
export type PushKind =
	| "lens_deadline"
	| "low_stock"
	| "routine_review"
	| "case_replace";
export interface RecordMeta {
	id: Id;
	created: Instant;
	updated: Instant;
}
export interface OwnedRecord extends RecordMeta {
	owner: Id;
}
export interface User {
	id: Id;
	email: string;
	displayName: string;
	timeZone: TimeZone;
}
export interface Product extends OwnedRecord {
	name: string;
	brand: string;
	barcode: string;
	kind: LensKind;
	defaultReplacementDays: number | null;
	notes: string;
}
export interface Prescription extends OwnedRecord {
	title: string;
	issuedOn: LocalDate;
	validUntil: LocalDate | null;
	prescriber: string;
	notes: string;
}
export interface PrescriptionEye extends OwnedRecord {
	prescription: Id;
	eye: Eye;
	sphere: number;
	cylinder: number | null;
	axis: number | null;
	add: number | null;
	baseCurve: number | null;
	diameter: number | null;
	product: Id | null;
	replacementDays: number | null;
	wearPolicy: WearPolicy;
	overnightMaxHours: number | null;
}
export interface PrescriptionDocument extends OwnedRecord {
	prescription: Id;
	file: string;
	label: string;
	extractionStatus: "not_requested"; // Reserved extension point; no OCR implementation.
}
export interface Purchase extends OwnedRecord {
	purchasedOn: LocalDate;
	merchant: string;
	totalMinor: number;
	currency: string;
	notes: string;
}
export interface InventoryLot extends OwnedRecord {
	product: Id;
	prescriptionEye: Id | null;
	eye: Eye | "either";
	packageExpiry: LocalDate;
	quantityRemaining: number;
	lowStockThreshold: number;
	purchase: Id | null;
	unitCostMinor: number | null;
	currency: string;
}
export interface StockMovement extends OwnedRecord {
	lot: Id;
	delta: number;
	reason: StockReason;
	lens: Id | null;
	purchase: Id | null;
	occurredAt: Instant;
	notes: string;
}
export interface Lens extends OwnedRecord {
	lot: Id;
	prescriptionEye: Id;
	eye: Eye;
	kind: LensKind;
	wearPolicy: WearPolicy;
	replacementDays: number | null;
	overnightMaxHours: number | null;
	openedAt: Instant;
	openingTimeZone: TimeZone;
	packageExpiry: LocalDate;
	deadlineAt: Instant;
	status: LensStatus;
	disposedAt: Instant | null;
	disposalReason: DisposalReason | null;
	notes: string;
}
export interface WearSession extends OwnedRecord {
	lens: Id;
	eye: Eye;
	startedAt: Instant;
	endedAt: Instant | null;
	timeZone: TimeZone;
	source: SessionSource;
	state: SessionState;
	endMethod: "user" | "routine" | "deadline" | "disposal" | null;
	review: ReviewState;
	policyWarnings: PolicyWarning[];
	routine: Id | null;
	occurrenceKey: string;
	originalStartedAt: Instant | null;
	originalEndedAt: Instant | null;
	notes: string;
}
export interface Routine extends OwnedRecord {
	name: string;
	enabled: boolean;
	eyes: Eye[];
	timeZone: TimeZone;
	weekdays: number[]; // ISO Monday=1 … Sunday=7
	startLocal: LocalTime;
	endLocal: LocalTime;
	endDayOffset: 0 | 1;
	effectiveFrom: LocalDate;
	effectiveUntil: LocalDate | null;
	revision: number;
}
export interface LensCase extends OwnedRecord {
	name: string;
	startedOn: LocalDate;
	replaceOn: LocalDate;
	lastCleanedAt: Instant | null;
	retiredAt: Instant | null;
	notes: string;
}
export interface ComfortLog extends OwnedRecord {
	occurredAt: Instant;
	timeZone: TimeZone;
	eye: Eye | "both";
	lens: Id | null;
	comfort: number; // integer 1 (poor) to 5 (good)
	problems: ProblemKind[];
	notes: string;
}
export interface PushDevice extends OwnedRecord {
	installationId: string;
	expoPushToken: string;
	platform: "ios";
	enabled: boolean;
	lastSeenAt: Instant;
}
/** Internal collections; not accessible to client record APIs. */
export interface MutationReceipt extends OwnedRecord {
	key: string;
	route: string;
	requestHash: string;
	responseJson: string;
}
export interface RoutineOccurrence extends OwnedRecord {
	key: string;
	routine: Id;
	lens: Id | null;
	localDate: LocalDate; // lens required when generated; nullable only when skipped
	status: "generated" | "skipped";
	reason: string;
}
export interface PushJob extends OwnedRecord {
	key: string;
	kind: PushKind;
	subject: Id;
	scheduledAt: Instant;
	status: "pending" | "sending" | "sent" | "failed" | "cancelled";
	attempts: number;
	nextAttemptAt: Instant | null;
	ticketIds: string[];
	lastError: string;
}
export interface CollectionRecords {
	users: User;
	products: Product;
	prescriptions: Prescription;
	prescription_eyes: PrescriptionEye;
	prescription_documents: PrescriptionDocument;
	purchases: Purchase;
	inventory_lots: InventoryLot;
	stock_movements: StockMovement;
	lenses: Lens;
	wear_sessions: WearSession;
	routines: Routine;
	lens_cases: LensCase;
	comfort_logs: ComfortLog;
	push_devices: PushDevice;
	mutation_receipts: MutationReceipt;
	routine_occurrences: RoutineOccurrence;
	push_jobs: PushJob;
}
export interface ApiError {
	error: {
		code:
			| "validation"
			| "unauthorized"
			| "unverified"
			| "not_found"
			| "conflict"
			| "insufficient_stock"
			| "deadline_reached"
			| "overlap"
			| "idempotency_mismatch"
			| "rate_limited"
			| "internal";
		message: string;
		fields?: Record<string, string>;
	};
}
export interface OpenLensRequest {
	lot: Id;
	prescriptionEye: Id;
	openedAt: Instant;
	timeZone: TimeZone;
	notes?: string;
}
export interface OpenLensResponse {
	lens: Lens;
	lot: InventoryLot;
	movement: StockMovement;
}
export interface DisposeLensRequest {
	lens: Id;
	disposedAt: Instant;
	reason: DisposalReason;
	notes?: string;
}
export interface DisposeLensResponse {
	lens: Lens;
	closedSessions: WearSession[];
}
export interface RecordPurchaseRequest {
	purchasedOn: LocalDate;
	merchant: string;
	totalMinor: number;
	currency: string;
	notes?: string;
	items: Array<{
		product: Id;
		prescriptionEye: Id | null;
		eye: Eye | "either";
		packageExpiry: LocalDate;
		quantity: number;
		lowStockThreshold: number;
		unitCostMinor: number | null;
	}>;
}
export interface RecordPurchaseResponse {
	purchase: Purchase;
	lots: InventoryLot[];
	movements: StockMovement[];
}
export interface AdjustStockRequest {
	lot: Id;
	delta: number;
	reason: "adjustment" | "discard_unopened";
	occurredAt: Instant;
	notes: string;
}
export interface AdjustStockResponse {
	lot: InventoryLot;
	movement: StockMovement;
}
export interface ConfigureLotRequest {
	lot: Id;
	lowStockThreshold: number;
}
export interface ConfigureLotResponse {
	lot: InventoryLot;
}
export interface SaveSessionRequest {
	id?: Id;
	lens: Id;
	startedAt: Instant;
	endedAt: Instant | null;
	timeZone: TimeZone;
	notes?: string;
}
export interface SaveSessionResponse {
	session: WearSession;
	lens: Lens;
}
export interface ReviewSessionRequest {
	session: Id;
	action: "confirm" | "correct" | "delete";
	startedAt?: Instant;
	endedAt?: Instant;
	notes?: string;
}
export interface ReviewSessionResponse {
	session: WearSession | null;
	lens: Lens;
}
export interface DeleteSessionRequest {
	session: Id;
}
export interface DeleteSessionResponse {
	deleted: Id;
}
export interface SaveRoutineRequest {
	id?: Id;
	name: string;
	enabled: boolean;
	eyes: Eye[];
	timeZone: TimeZone;
	weekdays: number[];
	startLocal: LocalTime;
	endLocal: LocalTime;
	endDayOffset: 0 | 1;
	effectiveFrom: LocalDate;
	effectiveUntil: LocalDate | null;
}
export interface SaveRoutineResponse {
	routine: Routine;
}
export interface RegisterDeviceRequest {
	installationId: string;
	expoPushToken: string;
	platform: "ios";
	enabled: boolean;
}
export interface RegisterDeviceResponse {
	device: PushDevice;
}
export interface ExportRequest {
	format: "json" | "csv";
}
export interface ExportDownloadResponse {
	contentType: "application/json" | "application/zip";
	filename: "oculog-export.json" | "oculog-export.zip";
	body: Uint8Array; // Download bytes, not a JSON response envelope.
}
export type ExportCollectionName = Exclude<
	keyof CollectionRecords,
	| "users"
	| "push_devices"
	| "mutation_receipts"
	| "routine_occurrences"
	| "push_jobs"
>;
export interface JsonExport {
	schemaVersion: 1;
	exportedAt: Instant;
	user: User;
	collections: { [K in ExportCollectionName]: CollectionRecords[K][] };
}
export interface CsvExportManifest {
	schemaVersion: 1;
	exportedAt: Instant;
	files: string[];
}
export interface AnalyticsRequest {
	from: Instant;
	to: Instant;
}
export interface DeleteAccountRequest {
	password: string;
	confirmation: "DELETE";
}
export interface DeleteAccountResponse {
	deleted: true;
}
export interface AnalyticsResponse {
	from: Instant;
	to: Instant;
	eyes: Array<{
		eye: Eye;
		exactSeconds: number;
		estimatedSeconds: number;
		confirmedEstimatedSeconds: number;
		sessionCount: number;
	}>;
	predictions: Array<{
		lot: Id;
		remainingUnits: number;
		predictedEmptyOn: LocalDate | null;
		basis: "last_30_days_openings";
		sampleDays: number;
	}>;
}
export interface EndpointContract<Request, Response> {
	request: Request;
	response: Response;
}
/** All POST except analytics GET (request fields are query parameters).
 * Export returns download bytes with Content-Type and attachment filename headers.
 */
export interface Endpoints {
	"/api/oculog/v1/analytics": EndpointContract<
		AnalyticsRequest,
		AnalyticsResponse
	>;
	"/api/oculog/v1/account/export": EndpointContract<
		ExportRequest,
		ExportDownloadResponse
	>;
	"/api/oculog/v1/lenses/open": EndpointContract<
		OpenLensRequest,
		OpenLensResponse
	>;
	"/api/oculog/v1/lenses/dispose": EndpointContract<
		DisposeLensRequest,
		DisposeLensResponse
	>;
	"/api/oculog/v1/purchases/record": EndpointContract<
		RecordPurchaseRequest,
		RecordPurchaseResponse
	>;
	"/api/oculog/v1/stock/adjust": EndpointContract<
		AdjustStockRequest,
		AdjustStockResponse
	>;
	"/api/oculog/v1/stock/configure": EndpointContract<
		ConfigureLotRequest,
		ConfigureLotResponse
	>;
	"/api/oculog/v1/sessions/save": EndpointContract<
		SaveSessionRequest,
		SaveSessionResponse
	>;
	"/api/oculog/v1/sessions/review": EndpointContract<
		ReviewSessionRequest,
		ReviewSessionResponse
	>;
	"/api/oculog/v1/sessions/delete": EndpointContract<
		DeleteSessionRequest,
		DeleteSessionResponse
	>;
	"/api/oculog/v1/routines/save": EndpointContract<
		SaveRoutineRequest,
		SaveRoutineResponse
	>;
	"/api/oculog/v1/devices/register": EndpointContract<
		RegisterDeviceRequest,
		RegisterDeviceResponse
	>;
	"/api/oculog/v1/account/delete": EndpointContract<
		DeleteAccountRequest,
		DeleteAccountResponse
	>;
}
