// Sets the theme before the first paint. Loaded as a classic script from index.html.
const savedTheme = localStorage.getItem("quiltor-theme") || "system";
document.documentElement.dataset.theme =
  savedTheme === "system"
    ? matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : savedTheme;
