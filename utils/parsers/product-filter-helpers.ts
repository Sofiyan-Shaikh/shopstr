import { ProductData } from "./product-parser-functions";
import { listingMatchesSearchString } from "./listing-search-predicate";

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Checks if a product satisfies the category filter.
 * @param productData - The product to check.
 * @param selectedCategories - Set of selected category names.
 * @returns boolean
 */
export const productSatisfiesCategoryFilter = (
  productData: ProductData,
  selectedCategories: Set<string>
) => {
  if (selectedCategories.size === 0) return true;
  return Array.from(selectedCategories).some((selectedCategory) => {
    const re = new RegExp(escapeRegExp(selectedCategory), "gi");
    return productData?.categories?.some((category) => {
      const match = category.match(re);
      return match && match.length > 0;
    });
  });
};

/**
 * Checks if a product satisfies the location filter.
 * @param productData - The product to check.
 * @param selectedLocation - The selected location string.
 * @returns boolean
 */
export const productSatisfiesLocationFilter = (
  productData: ProductData,
  selectedLocation: string
) => {
  return !selectedLocation || productData.location === selectedLocation;
};

/**
 * Checks if a product satisfies the search filter.
 *
 * Delegates to the isolated listing search predicate so the same
 * logic can be reused and compared against a future NIP-50 flow.
 * See `./listing-search-predicate.ts`.
 */
export const productSatisfiesSearchFilter = (
  productData: ProductData,
  selectedSearch: string
) => listingMatchesSearchString(productData, selectedSearch);

/**
 * Checks if a product has a valid price (>= 1 in its currency).
 * Products with a price below 1 are considered invalid and hidden.
 * @param productData - The product to check.
 * @returns boolean
 */
export const productSatisfiesPriceFilter = (productData: ProductData) => {
  return Number(productData.price) >= 1;
};

/**
 * Orchestrates all individual filters for a product.
 */
export const productSatisfiesAllFilters = (
  productData: ProductData,
  filters: {
    selectedCategories: Set<string>;
    selectedLocation: string;
    selectedSearch: string;
  }
) => {
  return (
    productSatisfiesPriceFilter(productData) &&
    productSatisfiesCategoryFilter(productData, filters.selectedCategories) &&
    productSatisfiesLocationFilter(productData, filters.selectedLocation) &&
    productSatisfiesSearchFilter(productData, filters.selectedSearch)
  );
};
