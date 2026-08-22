export const loadSearchDialog = () =>
  import("./SearchDialog").then(({ SearchDialog }) => ({ default: SearchDialog }));
