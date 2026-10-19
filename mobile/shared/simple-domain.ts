/** Calendar-only logger; no prescriptions, lots, sessions or measured wear. */
export type SimpleEye = "left" | "right";
export const SIMPLE_COLLECTIONS = {
	settings: "simple_lens_settings",
	daily: "daily_logs",
} as const;
export const SIMPLE_PATHS = {
	state: "/api/oculog/v1/simple/state",
	settings: "/api/oculog/v1/simple/settings",
	add: "/api/oculog/v1/simple/add",
	replace: "/api/oculog/v1/simple/replace",
	day: "/api/oculog/v1/simple/day",
} as const;
export interface SimpleLensSettings {
	id: string;
	owner: string;
	eye: SimpleEye;
	replacementDays: number | null;
	openedOn: string | null;
	dueOn: string | null;
	timeZone: string;
	spareCount: number;
}
export interface SimpleDailyLog {
	id: string;
	owner: string;
	localDate: string;
	timeZone: string;
	worn: boolean;
}
export interface SimpleEyeState {
	id: string | null;
	eye: SimpleEye;
	replacementDays: number | null;
	openedOn: string | null;
	dueOn: string | null;
	spareCount: number;
	daysRemaining: number | null;
}
export interface SimpleState {
	today: string;
	timeZone: string;
	eyes: SimpleEyeState[];
	daily: { localDate: string; worn: boolean | null };
}
export interface SimpleSettingsRequest {
	eye: SimpleEye;
	replacementDays: number;
	openedOn: string | null;
	timeZone: string;
}
export interface SimpleAddRequest {
	eye: SimpleEye;
	quantity: number;
}
export interface SimpleReplaceRequest {
	eye: SimpleEye;
}
export interface SimpleDayRequest {
	localDate: string;
	worn: boolean;
}
export const SIMPLE_IDEMPOTENCY_HEADER = "Idempotency-Key";
