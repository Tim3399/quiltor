//! Minimal stable ABI surface for native Quiltor hosts.
//!
//! Rich operations are added through generated bindings after their request and
//! response payloads exist in `contracts/`. No host receives Rust internals.

/// Return the application-contract version supported by the portable core.
// Exporting a stable symbol is explicitly unsafe in current Rust because the
// linker cannot protect us from duplicate symbol names. Allow only that
// attribute on this one reviewed item; actual unsafe code remains denied by
// the workspace lint and the repository architecture gate.
#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn quiltor_application_contract_version() -> u32 {
    quiltor_core::APPLICATION_CONTRACT_VERSION
}

#[cfg(test)]
mod tests {
    use super::quiltor_application_contract_version;

    #[test]
    fn ffi_reports_the_core_contract_version() {
        assert_eq!(quiltor_application_contract_version(), 1);
    }
}
