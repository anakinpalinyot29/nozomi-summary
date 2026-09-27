/* Keep the patched SheetJS reader before xlsx-style.bundle.js replaces the XLSX global. */
window.XLSX_READ = window.XLSX;
