export interface PksViolation {
  message: string;
  file: string;
  line: number;
  column: number;
  violation_type: string;
  strict: boolean;
  constant_name: string;
  referencing_pack_name: string;
  defining_pack_name: string;
}

export interface PksOutput {
  status: string;
  violations: Array<PksViolation>;
  stale_violations?: Array<PksViolation>;
  strict_mode_violations?: Array<PksViolation>;
}

// Metadata stored on diagnostics for code actions
export interface ViolationMetadata {
  file: string;
  violation_type: string;
  constant_name: string;
  referencing_pack_name: string;
  defining_pack_name: string;
}

// Types for pks validate --json output
export interface CycleEdge {
  from_pack: string;
  to_pack: string;
  file: string;
}

export interface ValidationError {
  error_type: string;
  message: string;
  cycle_edges?: CycleEdge[];
  file?: string;
}

export interface PksValidateOutput {
  status: string;
  validation_errors: ValidationError[];
}

// Metadata stored on cycle diagnostics for code actions
export interface CycleDiagnosticMetadata {
  from_pack: string;
  to_pack: string;
}
