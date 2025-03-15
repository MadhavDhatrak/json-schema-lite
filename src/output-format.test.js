import { describe, it, expect } from "vitest";
import { validate } from "./index.js";

describe("Basic Output Format", () => {
  it("should return valid=true for valid data", () => {
    const schema = { type: "number" };
    const instance = 42;
    const result = validate(schema, instance);

    expect(result.valid).to.equal(true);
    expect(result.instanceLocation).to.equal("#");
    expect(result.absoluteKeywordLocation).to.equal("#");
    expect(result.errors).to.equal(undefined);
  });

  it("should return valid=false with errors for invalid data", () => {
    const schema = { type: "number" };
    const instance = "not a number";
    const result = validate(schema, instance);

    expect(result.valid).to.equal(false);
    expect(result.instanceLocation).to.equal("#");
    expect(result.absoluteKeywordLocation).to.equal("#");
    expect(result.errors).to.not.equal(undefined);
    expect(Array.isArray(result.errors)).to.equal(true);
    if (result.errors) {
      expect(result.errors[0]).to.have.property("instanceLocation");
      expect(result.errors[0]).to.have.property("absoluteKeywordLocation");
    }
  });

  it("should handle allOf validation", () => {
    /** @type {import("./jsonast.d.ts").Json} */
    const schema = {
      allOf: [
        { type: "object" },
        { required: ["name"] }
      ]
    };
    /** @type {import("./jsonast.d.ts").Json} */
    const instance = { id: 123 };
    const result = validate(schema, instance);

    expect(result.valid).to.equal(false);
    expect(result.errors).to.not.equal(undefined);
    if (result.errors) {
      expect(result.errors.length).to.be.greaterThan(0);
    }
  });

  it("should handle required validation", () => {
    const schema = {
      type: "object",
      required: ["name", "email"]
    };
    const instance = { name: "John" };
    const result = validate(schema, instance);

    expect(result.valid).to.equal(false);
    expect(result.errors).to.not.equal(undefined);
  });

  it("should handle properties validation", () => {
    const schema = {
      type: "object",
      properties: {
        age: { type: "number" }
      }
    };
    const instance = { age: "twenty" };
    const result = validate(schema, instance);

    expect(result.valid).to.equal(false);
    expect(result.errors).to.not.equal(undefined);
  });

  it("should handle $ref validation", () => {
    const schema = {
      $ref: "#/$defs/person",
      $defs: {
        person: {
          type: "object",
          required: ["name"]
        }
      }
    };
    /** @type {import("./jsonast.d.ts").Json} */
    const instance = {};
    const result = validate(schema, instance);

    expect(result.valid).to.equal(false);
    expect(result.errors).to.not.equal(undefined);
  });
});
