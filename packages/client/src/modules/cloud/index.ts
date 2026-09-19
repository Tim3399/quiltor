export function loadCloudDialog() {
  return import("./CloudDialog").then(({ CloudDialog }) => ({ default: CloudDialog }));
}
