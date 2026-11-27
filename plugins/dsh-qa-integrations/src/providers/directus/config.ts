import { scopedConfigError } from "../../errors.js";
import {
  resolveEndpointList,
  type EndpointAddress,
} from "../kernel/address.js";

const IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u;
const configError = scopedConfigError("Directus integration config");

export interface DirectusCollection {
  readonly name: string;
  readonly primaryKey: string;
  readonly fields: readonly string[];
  readonly fileFields?: readonly string[];
}

export interface DirectusInstance extends EndpointAddress {
  readonly collections: readonly DirectusCollection[];
}

export interface DirectusConfig {
  readonly instances: readonly DirectusInstance[];
}

export function resolveDirectusConfig(input?: DirectusConfig): DirectusConfig {
  const instances = resolveEndpointList(input?.instances, false, {
    error: configError,
    field: "instances",
    noun: "Directus API",
    extra(record, index): Pick<DirectusInstance, "collections"> {
      const collections = record["collections"];
      if (
        !Array.isArray(collections) ||
        collections.length < 1 ||
        collections.length > 32
      ) {
        throw configError(
          `instances[${index}].collections must list 1–32 collections`,
        );
      }
      const seen = new Set<string>();
      const allowed = collections.map((value: unknown): DirectusCollection => {
        if (value === null || typeof value !== "object") {
          throw configError("Each collection must be a mapping");
        }
        const { name, primaryKey, fields, fileFields } = value as Record<
          string,
          unknown
        >;
        if (
          typeof name !== "string" ||
          !IDENTIFIER.test(name) ||
          name.toLowerCase().startsWith("directus_") ||
          seen.has(name.toLowerCase())
        ) {
          throw configError("Use unique, non-system collection names");
        }
        if (
          typeof primaryKey !== "string" ||
          !IDENTIFIER.test(primaryKey) ||
          !Array.isArray(fields) ||
          fields.length < 1 ||
          fields.length > 32 ||
          !fields.every(
            (field: unknown) =>
              typeof field === "string" && IDENTIFIER.test(field),
          ) ||
          new Set(fields).size !== fields.length ||
          !fields.includes(primaryKey)
        ) {
          throw configError(
            `Collection ${name} needs 1–32 explicit fields including its primary key`,
          );
        }
        if (
          fileFields !== undefined &&
          (!Array.isArray(fileFields) ||
            !fileFields.every(
              (field: unknown) =>
                field !== primaryKey && fields.includes(field),
            ) ||
            new Set(fileFields).size !== fileFields.length)
        ) {
          throw configError(
            `Collection ${name} fileFields must reference explicit non-primary fields`,
          );
        }
        seen.add(name.toLowerCase());
        return Object.freeze({
          name,
          primaryKey,
          fields: Object.freeze([...fields] as string[]),
          ...(fileFields === undefined
            ? {}
            : { fileFields: Object.freeze([...fileFields] as string[]) }),
        });
      });
      return { collections: Object.freeze(allowed) };
    },
  });
  return { instances };
}
