// Consistent error shape for every endpoint:
// { "error": { "code": "DUPLICATE_SLUG", "message": "...", "details": [...] } }
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const UNIQUE = {
  categories_slug_key: ['DUPLICATE_SLUG', 'A category with this slug already exists'],
  products_slug_key: ['DUPLICATE_SLUG', 'A product with this slug already exists'],
  skus_sku_code_key: ['DUPLICATE_SKU_CODE', 'A SKU with this code already exists'],
  variants_combination_key: ['DUPLICATE_VARIANT', 'This variant combination already exists for the product'],
  skus_one_default_per_product: ['DUPLICATE_DEFAULT_SKU', 'The product already has a default (variant-less) SKU'],
};

const CHECK = {
  skus_stock_non_negative: ['NEGATIVE_STOCK', 'stock_quantity cannot be negative'],
  skus_price_positive: ['INVALID_PRICE', 'price must be greater than zero'],
  skus_cost_non_negative: ['INVALID_COST', 'cost_price cannot be negative'],
  categories_not_own_parent: ['CATEGORY_CYCLE', 'A category cannot be its own parent'],
};

const TRIGGERS = {
  BQ001: ['CATEGORY_CYCLE', 'A category cannot become its own ancestor'],
  BQ002: ['PARENT_INACTIVE', 'Cannot activate a category whose parent is inactive'],
  BQ003: ['NOT_SELLABLE', 'A published product must keep at least one active SKU'],
  BQ004: ['VARIANT_MISMATCH', 'Variants and variant-less SKUs cannot be mixed on one product'],
};

// Translate PostgreSQL errors into client-friendly ApiErrors (never a traceback).
export function toApiError(err) {
  if (err instanceof ApiError) return err;
  const c = err && err.code;
  if (c === '23505') {
    const [code, msg] = UNIQUE[err.constraint] || ['DUPLICATE_VALUE', 'A unique value already exists'];
    return new ApiError(409, code, msg);
  }
  if (c === '23514') {
    const [code, msg] = CHECK[err.constraint] || ['CONSTRAINT_VIOLATION', `Value rejected by constraint ${err.constraint}`];
    return new ApiError(422, code, msg);
  }
  if (c === '23503') {
    if (err.constraint === 'skus_variant_same_product_fkey') {
      return new ApiError(422, 'INVALID_REFERENCE', 'variant_id must reference a variant of the same product');
    }
    if (/update or delete on table/.test(err.message || '')) {
      return new ApiError(409, 'IN_USE', 'This record is still referenced by other records');
    }
    return new ApiError(422, 'INVALID_REFERENCE', 'A referenced record does not exist');
  }
  if (TRIGGERS[c]) return new ApiError(422, TRIGGERS[c][0], err.message || TRIGGERS[c][1]);
  if (c === '22P02' || c === '22003') return new ApiError(400, 'VALIDATION_ERROR', 'A value has an invalid format or is out of range');
  return null;
}
