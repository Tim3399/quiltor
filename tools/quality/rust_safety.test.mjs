import assert from "node:assert/strict";
import test from "node:test";
import { rustSafetyViolations } from "./rust_safety.mjs";

test("rejects a crate-wide unsafe allowance", () => {
  assert.deepEqual(
    rustSafetyViolations("crates/quiltor-ffi/src/lib.rs", "#![allow(unsafe_code)]"),
    ["crate-wide unsafe_code allowances are forbidden"],
  );
});

test("rejects real unsafe code even inside the FFI crate", () => {
  const source = `
#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn quiltor_application_contract_version() -> u32 {
  unsafe { *core::ptr::null() }
}`;

  assert.deepEqual(rustSafetyViolations("crates/quiltor-ffi/src/lib.rs", source), [
    "actual unsafe Rust requires a separately reviewed boundary",
  ]);
});

test("permits only the reviewed safe no_mangle export", () => {
  const source = `
#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn quiltor_application_contract_version() -> u32 {
  quiltor_core::APPLICATION_CONTRACT_VERSION
}`;

  assert.deepEqual(rustSafetyViolations("crates/quiltor-ffi/src/lib.rs", source), []);
});

test("rejects item allowances elsewhere", () => {
  assert.deepEqual(
    rustSafetyViolations(
      "crates/quiltor-core/src/lib.rs",
      "#[allow(unsafe_code)]\npub fn core() {}",
    ),
    ["unsafe_code may only allow the reviewed no_mangle FFI export item"],
  );
});
