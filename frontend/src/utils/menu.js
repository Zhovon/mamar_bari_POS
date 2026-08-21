// Shared menu-grouping logic so the waiter POS and the customer QR menu render
// identical, correctly-ordered category sections from the same item list.

// Group a flat menu-item list into ordered [{ category, items }] sections.
// Sections follow each category's server-provided sort_order (category_sort);
// items inside a section stay in the order the API returned them (name).
export function groupMenuByCategory(items = []) {
  const sections = new Map();
  for (const item of items) {
    const key = item.category || 'Uncategorised';
    if (!sections.has(key)) {
      sections.set(key, { category: key, sort: item.category_sort ?? 999999, items: [] });
    }
    sections.get(key).items.push(item);
  }
  return [...sections.values()]
    .sort((a, b) => a.sort - b.sort || a.category.localeCompare(b.category))
    .map(({ category, items }) => ({ category, items }));
}

// The category names, in display order, for a chip / tab bar.
export function categoryNames(items = []) {
  return groupMenuByCategory(items).map((s) => s.category);
}
