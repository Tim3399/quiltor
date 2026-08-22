const ffiEntry = "crates/quiltor-ffi/src/lib.rs";

export function rustSafetyViolations(relativePath, source) {
  const violations = [];

  if (/#!\s*\[\s*allow\s*\(\s*unsafe_code\s*\)\s*\]/.test(source)) {
    violations.push("crate-wide unsafe_code allowances are forbidden");
  }

  if (/\bunsafe\s*\{|\bunsafe\s+(?:extern|fn|impl|trait)\b/.test(source)) {
    violations.push("actual unsafe Rust requires a separately reviewed boundary");
  }

  const itemAllowances = source.match(/#\s*\[\s*allow\s*\(\s*unsafe_code\s*\)\s*\]/g) ?? [];
  if (itemAllowances.length > 0) {
    const allowedFfiExport =
      relativePath === ffiEntry &&
      itemAllowances.length === 1 &&
      /#\s*\[\s*allow\s*\(\s*unsafe_code\s*\)\s*\]\s*#\s*\[\s*unsafe\s*\(\s*no_mangle\s*\)\s*\]\s*pub\s+extern\s+"C"\s+fn\s+quiltor_application_contract_version\b/s.test(
        source,
      );
    if (!allowedFfiExport) {
      violations.push("unsafe_code may only allow the reviewed no_mangle FFI export item");
    }
  }

  return violations;
}
