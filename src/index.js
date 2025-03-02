import jsonStringify from "json-stringify-deterministic";
import { parseIriReference, toAbsoluteIri } from "@hyperjump/uri";
import {
  assertNodeType,
  toJsonNode,
  isNodeType,
  jsonObjectHas,
  jsonObjectKeys,
  jsonPointerGet,
  jsonPointerStep,
  jsonValue,
  toSchemaNode
} from "./jsonast-util.js";

/**
 * @import {
 *   Json,
 *   JsonNode,
 *   JsonObjectNode,
 *   JsonStringNode,
 *   SchemaNode
 * } from "./jsonast.d.ts"
 */


/** @type (schema: Json, instance: Json) => boolean */
export const validate = (schema, instance) => {
  registerSchema(schema, "");
  const schemaNode = /** @type NonNullable<SchemaNode> */ (schemaRegistry.get(""));
  const isValid = validateSchema(schemaNode, toJsonNode(instance));
  schemaRegistry.delete("");
  return isValid;
};

/** @type (schemaNode: SchemaNode, instanceNode: JsonNode) => boolean */
const validateSchema = (schemaNode, instanceNode) => {
  if (schemaNode.type === "json") {
    switch (schemaNode.jsonType) {
      case "boolean":
        return schemaNode.value;
      case "object":
        for (const propertyNode of schemaNode.children) {
          const [keywordNode, keywordValueNode] = propertyNode.children;
          const keywordHandler = keywordHandlers.get(keywordNode.value);
          if (keywordHandler && !keywordHandler(keywordValueNode, instanceNode, schemaNode)) {
            return false;
          }
        }
        return true;
    }
  }

  throw Error("Invalid Schema");
};

/** @type Map<string, SchemaNode> */
const schemaRegistry = new Map();

/** @type (schema: Json, uri: string) => void */
export const registerSchema = (schema, uri) => {
  schemaRegistry.set(uri, toSchemaNode(schema, uri));
};

/**
 * @typedef {(
 *   keywordNode: SchemaNode,
 *   instanceNode: JsonNode,
 *   schemaNode: JsonObjectNode<SchemaNode>
 * ) => boolean} KeywordHandler
 */

/** @type Map<string, KeywordHandler> */
const keywordHandlers = new Map();

keywordHandlers.set("$ref", (refNode, instanceNode) => {
  assertNodeType(refNode, "reference");
  const pointer = decodeURI(parseIriReference(refNode.value).fragment ?? "");
  const uri = refNode.value.startsWith("#") ? "" : toAbsoluteIri(refNode.value);

  const schemaNode = schemaRegistry.get(uri);
  if (!schemaNode) {
    throw Error(`Invalid reference: ${uri}`);
  }

  const referencedSchemaNode = jsonPointerGet(pointer, schemaNode, uri);

  return validateSchema(referencedSchemaNode, instanceNode);
});

keywordHandlers.set("additionalProperties", (additionalPropertiesNode, instanceNode, schemaNode) => {
  if (instanceNode.jsonType !== "object") {
    return true;
  }

  const propertyPatterns = [];

  if (jsonObjectHas("properties", schemaNode)) {
    const propertiesNode = jsonPointerStep("properties", schemaNode);
    if (isNodeType(propertiesNode, "object")) {
      for (const propertyName of jsonObjectKeys(propertiesNode)) {
        propertyPatterns.push(`^${regexEscape(propertyName)}$`);
      }
    }
  }

  if (jsonObjectHas("patternProperties", schemaNode)) {
    const patternPropertiesNode = jsonPointerStep("patternProperties", schemaNode);
    if (isNodeType(patternPropertiesNode, "object")) {
      propertyPatterns.push(...jsonObjectKeys(patternPropertiesNode));
    }
  }

  const isDefinedProperty = new RegExp(propertyPatterns.length > 0 ? propertyPatterns.join("|") : "(?!)", "u");

  for (const propertyNode of instanceNode.children) {
    const [propertyNameNode, instancePropertyNode] = propertyNode.children;
    if (!isDefinedProperty.test(propertyNameNode.value) && !validateSchema(additionalPropertiesNode, instancePropertyNode)) {
      return false;
    }
  }

  return true;
});

/** @type (string: string) => string */
const regexEscape = (string) => string
  .replace(/[|\\{}()[\]^$+*?.]/g, "\\$&")
  .replace(/-/g, "\\x2d");

keywordHandlers.set("allOf", (allOfNode, instanceNode) => {
  assertNodeType(allOfNode, "array");
  for (const schemaNode of allOfNode.children) {
    if (!validateSchema(schemaNode, instanceNode)) {
      return false;
    }
  }
  return true;
});

keywordHandlers.set("anyOf", (anyOfNode, instanceNode) => {
  assertNodeType(anyOfNode, "array");
  for (const schemaNode of anyOfNode.children) {
    if (validateSchema(schemaNode, instanceNode)) {
      return true;
    }
  }
  return false;
});

keywordHandlers.set("oneOf", (oneOfNode, instanceNode) => {
  assertNodeType(oneOfNode, "array");

  let matches = 0;
  for (const schemaNode of oneOfNode.children) {
    if (validateSchema(schemaNode, instanceNode)) {
      matches++;
    }
  }
  return matches === 1;
});

keywordHandlers.set("not", (notNode, instanceNode) => {
  return !validateSchema(notNode, instanceNode);
});

keywordHandlers.set("contains", (containsNode, instanceNode, schemaNode) => {
  if (instanceNode.jsonType !== "array") {
    return true;
  }

  let minContains = 1;
  if (jsonObjectHas("minContains", schemaNode)) {
    const minContainsNode = jsonPointerStep("minContains", schemaNode);
    if (isNodeType(minContainsNode, "number")) {
      minContains = minContainsNode.value;
    }
  }

  let maxContains = Number.MAX_SAFE_INTEGER;
  if (jsonObjectHas("maxContains", schemaNode)) {
    const maxContainsNode = jsonPointerStep("maxContains", schemaNode);
    if (isNodeType(maxContainsNode, "number")) {
      maxContains = maxContainsNode.value;
    }
  }

  let matches = 0;
  for (const itemNode of instanceNode.children) {
    if (validateSchema(containsNode, itemNode)) {
      matches++;
    }
  }

  return matches >= minContains && matches <= maxContains;
});

keywordHandlers.set("dependentSchemas", (dependentSchemasNode, instanceNode) => {
  if (instanceNode.jsonType !== "object") {
    return true;
  }

  assertNodeType(dependentSchemasNode, "object");
  for (const propertyNode of dependentSchemasNode.children) {
    const [keyNode, schemaNode] = propertyNode.children;
    if (jsonObjectHas(keyNode.value, instanceNode)) {
      if (!validateSchema(schemaNode, instanceNode)) {
        return false;
      }
    }
  }

  return true;
});

keywordHandlers.set("then", (thenNode, instanceNode, schemaNode) => {
  if (jsonObjectHas("if", schemaNode)) {
    const ifNode = jsonPointerStep("if", schemaNode);
    if (validateSchema(ifNode, instanceNode)) {
      return validateSchema(thenNode, instanceNode);
    }
  }

  return true;
});

keywordHandlers.set("else", (elseNode, instanceNode, schemaNode) => {
  if (jsonObjectHas("if", schemaNode)) {
    const ifNode = jsonPointerStep("if", schemaNode);
    if (!validateSchema(ifNode, instanceNode)) {
      return validateSchema(elseNode, instanceNode);
    }
  }

  return true;
});

keywordHandlers.set("items", (itemsNode, instanceNode, schemaNode) => {
  if (instanceNode.jsonType !== "array") {
    return true;
  }

  let numberOfPrefixItems = 0;
  if (jsonObjectHas("prefixItems", schemaNode)) {
    const prefixItemsNode = jsonPointerStep("prefixItems", schemaNode);
    if (isNodeType(prefixItemsNode, "array")) {
      numberOfPrefixItems = prefixItemsNode.children.length;
    }
  }

  for (const itemNode of instanceNode.children.slice(numberOfPrefixItems)) {
    if (!validateSchema(itemsNode, itemNode)) {
      return false;
    }
  }

  return true;
});

keywordHandlers.set("patternProperties", (patternPropertiesNode, instanceNode) => {
  if (instanceNode.jsonType !== "object") {
    return true;
  }

  assertNodeType(patternPropertiesNode, "object");
  for (const propertyNode of patternPropertiesNode.children) {
    const [patternNode, patternSchemaNode] = propertyNode.children;
    const pattern = new RegExp(patternNode.value, "u");
    for (const propertyNode of instanceNode.children) {
      const [propertyNameNode, propertyValueNode] = propertyNode.children;
      const propertyName = propertyNameNode.value;
      if (pattern.test(propertyName) && !validateSchema(patternSchemaNode, propertyValueNode)) {
        return false;
      }
    }
  }

  return true;
});

keywordHandlers.set("prefixItems", (prefixItemsNode, instanceNode) => {
  if (instanceNode.jsonType !== "array") {
    return true;
  }

  assertNodeType(prefixItemsNode, "array");
  for (let index = 0; index < instanceNode.children.length; index++) {
    if (prefixItemsNode.children[index] && !validateSchema(prefixItemsNode.children[index], instanceNode.children[index])) {
      return false;
    }
  }

  return true;
});

keywordHandlers.set("properties", (propertiesNode, instanceNode) => {
  if (instanceNode.jsonType !== "object") {
    return true;
  }

  assertNodeType(propertiesNode, "object");
  for (const jsonPropertyNode of instanceNode.children) {
    const [propertyNameNode, instancePropertyNode] = jsonPropertyNode.children;
    if (jsonObjectHas(propertyNameNode.value, propertiesNode)) {
      const schemaPropertyNode = jsonPointerStep(propertyNameNode.value, propertiesNode);
      if (!validateSchema(schemaPropertyNode, instancePropertyNode)) {
        return false;
      }
    }
  }

  return true;
});

keywordHandlers.set("propertyNames", (propertyNamesNode, instanceNode) => {
  if (instanceNode.jsonType !== "object") {
    return true;
  }

  for (const propertyNode of instanceNode.children) {
    /** @type JsonStringNode */
    const keyNode = {
      type: "json",
      jsonType: "string",
      value: propertyNode.children[0].value
    };
    if (!validateSchema(propertyNamesNode, keyNode)) {
      return false;
    }
  }

  return true;
});

keywordHandlers.set("const", (constNode, instanceNode) => {
  return jsonStringify(jsonValue(instanceNode)) === jsonStringify(jsonValue(constNode));
});

keywordHandlers.set("dependentRequired", (dependentRequiredNode, instanceNode) => {
  if (instanceNode.jsonType !== "object") {
    return true;
  }

  assertNodeType(dependentRequiredNode, "object");
  for (const propertyNode of dependentRequiredNode.children) {
    const [keyNode, requiredPropertiesNode] = propertyNode.children;
    if (jsonObjectHas(keyNode.value, instanceNode)) {
      assertNodeType(requiredPropertiesNode, "array");
      const isValid = requiredPropertiesNode.children.every((requiredPropertyNode) => {
        assertNodeType(requiredPropertyNode, "string");
        return jsonObjectHas(requiredPropertyNode.value, instanceNode);
      });

      if (!isValid) {
        return false;
      }
    }
  }

  return true;
});

keywordHandlers.set("enum", (enumNode, instanceNode) => {
  assertNodeType(enumNode, "array");

  const instanceValue = jsonStringify(jsonValue(instanceNode));
  for (const enumItemNode of enumNode.children) {
    if (jsonStringify(jsonValue(enumItemNode)) === instanceValue) {
      return true;
    }
  }
  return false;
});

keywordHandlers.set("exclusiveMaximum", (exclusiveMaximumNode, instanceNode) => {
  if (instanceNode.jsonType !== "number") {
    return true;
  }

  assertNodeType(exclusiveMaximumNode, "number");
  return instanceNode.value < exclusiveMaximumNode.value;
});

keywordHandlers.set("exclusiveMinimum", (exclusiveMinimumNode, instanceNode) => {
  if (instanceNode.jsonType !== "number") {
    return true;
  }

  assertNodeType(exclusiveMinimumNode, "number");
  return instanceNode.value > exclusiveMinimumNode.value;
});

keywordHandlers.set("maxItems", (maxItemsNode, instanceNode) => {
  if (instanceNode.jsonType !== "array") {
    return true;
  }

  assertNodeType(maxItemsNode, "number");
  return instanceNode.children.length <= maxItemsNode.value;
});

keywordHandlers.set("minItems", (minItemsNode, instanceNode) => {
  if (instanceNode.jsonType !== "array") {
    return true;
  }

  assertNodeType(minItemsNode, "number");
  return instanceNode.children.length >= minItemsNode.value;
});

keywordHandlers.set("maxLength", (maxLengthNode, instanceNode) => {
  if (instanceNode.jsonType !== "string") {
    return true;
  }

  assertNodeType(maxLengthNode, "number");
  return [...instanceNode.value].length <= maxLengthNode.value;
});

keywordHandlers.set("minLength", (minLengthNode, instanceNode) => {
  if (instanceNode.jsonType !== "string") {
    return true;
  }

  assertNodeType(minLengthNode, "number");
  return [...instanceNode.value].length >= minLengthNode.value;
});

keywordHandlers.set("maxProperties", (maxPropertiesNode, instanceNode) => {
  if (instanceNode.jsonType !== "object") {
    return true;
  }

  assertNodeType(maxPropertiesNode, "number");
  return instanceNode.children.length <= maxPropertiesNode.value;
});

keywordHandlers.set("minProperties", (minPropertiesNode, instanceNode) => {
  if (instanceNode.jsonType !== "object") {
    return true;
  }

  assertNodeType(minPropertiesNode, "number");
  return instanceNode.children.length >= minPropertiesNode.value;
});

keywordHandlers.set("maximum", (maximumNode, instanceNode) => {
  if (instanceNode.jsonType !== "number") {
    return true;
  }

  assertNodeType(maximumNode, "number");
  return instanceNode.value <= maximumNode.value;
});

keywordHandlers.set("minimum", (minimumNode, instanceNode) => {
  if (instanceNode.jsonType !== "number") {
    return true;
  }

  assertNodeType(minimumNode, "number");
  return instanceNode.value >= minimumNode.value;
});

keywordHandlers.set("multipleOf", (multipleOfNode, instanceNode) => {
  if (instanceNode.jsonType !== "number") {
    return true;
  }

  assertNodeType(multipleOfNode, "number");
  const remainder = instanceNode.value % multipleOfNode.value;
  return numberEqual(0, remainder) || numberEqual(multipleOfNode.value, remainder);
});

/** @type (a: number, b: number) => boolean */
const numberEqual = (a, b) => Math.abs(a - b) < 1.19209290e-7;

keywordHandlers.set("pattern", (patternNode, instanceNode) => {
  if (instanceNode.jsonType !== "string") {
    return true;
  }

  assertNodeType(patternNode, "string");
  return new RegExp(patternNode.value, "u").test(instanceNode.value);
});

keywordHandlers.set("required", (requiredNode, instanceNode) => {
  if (instanceNode.jsonType !== "object") {
    return true;
  }

  assertNodeType(requiredNode, "array");
  for (const requiredPropertyNode of requiredNode.children) {
    assertNodeType(requiredPropertyNode, "string");
    if (!jsonObjectHas(requiredPropertyNode.value, instanceNode)) {
      return false;
    }
  }
  return true;
});

keywordHandlers.set("type", (typeNode, instanceNode) => {
  if (typeNode.type === "json") {
    if (typeNode.jsonType === "string") {
      return isTypeOf(instanceNode, typeNode.value);
    }

    if (typeNode.jsonType === "array") {
      for (const itemNode of typeNode.children) {
        if (itemNode.type !== "json" || itemNode.jsonType != "string") {
          throw Error("Invalid Schema");
        }

        if (isTypeOf(instanceNode, itemNode.value)) {
          return true;
        }
      }

      return false;
    }
  }

  throw Error("Invalid Schema");
});

/** @type (instanceNode: JsonNode, type: string) => boolean */
const isTypeOf = (instance, type) => type === "integer"
  ? instance.jsonType === "number" && Number.isInteger(instance.value)
  : instance.jsonType === type;

keywordHandlers.set("uniqueItems", (uniqueItemsNode, instanceNode) => {
  if (instanceNode.jsonType !== "array") {
    return true;
  }

  assertNodeType(uniqueItemsNode, "boolean");

  if (uniqueItemsNode.value === false) {
    return true;
  }

  const normalizedItems = instanceNode.children.map((itemNode) => jsonStringify(jsonValue(itemNode)));
  return new Set(normalizedItems).size === normalizedItems.length;
});
