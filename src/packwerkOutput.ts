export interface PackwerkViolation {
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

export interface PackwerkOutput {
  status: string;
  violations: Array<PackwerkViolation>;
  stale_violations?: Array<PackwerkViolation>;
  strict_mode_violations?: Array<PackwerkViolation>;
}
