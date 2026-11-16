export function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

// Turns the booking form's address into Square's address shape, or null if incomplete.
export function validAddress(value) {
  if (!value || typeof value !== "object") return null;
  const address = {
    address_line_1: cleanText(value.line1, 120),
    address_line_2: cleanText(value.line2, 120),
    locality: cleanText(value.city, 80),
    administrative_district_level_1: cleanText(value.state, 2).toUpperCase(),
    postal_code: cleanText(value.postalCode, 12),
    country: "US",
  };
  if (!address.address_line_1 || !address.locality || !/^[A-Z]{2}$/.test(address.administrative_district_level_1)
      || !/^\d{5}(?:-\d{4})?$/.test(address.postal_code)) {
    return null;
  }
  if (!address.address_line_2) delete address.address_line_2;
  return address;
}
