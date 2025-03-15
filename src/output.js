/**
 * @import { JsonNode } from "./jsonast.d.ts"
 */

export class Output {
  valid;
  instanceLocation;
  absoluteKeywordLocation;
  /** @type {Output[] | undefined} */
  errors;

  /**
   * @param {boolean} valid
   * @param {JsonNode} keywordNode
   * @param {JsonNode} instanceNode
   * @param {Output[]} [errors]
   */
  constructor(valid, keywordNode, instanceNode, errors) {
    this.valid = valid;
    this.absoluteKeywordLocation = keywordNode.location;
    this.instanceLocation = instanceNode.location;

    // For Basic format, we need to ensure errors array exists when validation fails
    if (!valid) {
      // If errors were passed, use them
      if (errors && errors.length > 0) {
        this.errors = errors;
      } else {
        // Create a basic error object without recursion
        this.errors = [{
          valid: false,
          instanceLocation: this.instanceLocation,
          absoluteKeywordLocation: this.absoluteKeywordLocation,
          errors: undefined
        }];
      }
    } else if (errors && errors.length > 0) {
      // If validation is successful but we have child errors, include them
      this.errors = errors;
    }
  }
}
