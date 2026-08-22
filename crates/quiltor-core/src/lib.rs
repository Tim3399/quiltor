//! Portable deterministic product logic shared by desktop and mobile hosts.
//!
//! This crate deliberately has no operating-system, network, UI or process
//! dependencies. Operations move here only after their Python and TypeScript
//! behaviour is pinned by shared contract fixtures.

pub mod timeline;

/// Version of the host-neutral application contract understood by this core.
pub const APPLICATION_CONTRACT_VERSION: u32 = 1;
