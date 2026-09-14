/**
 * YAML テキストを読み、スキーマと参照整合性を検証して Ontology を返す。
 */
import { parse } from "yaml";

import { type Ontology, OntologySchema } from "./schema";

export class OntologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OntologyError";
  }
}

export function loadOntology(text: string, source = "ontology.yaml"): Ontology {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    throw new OntologyError(`${source} is not valid YAML: ${(e as Error).message}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OntologyError(`${source} must be a mapping at top level`);
  }
  const result = OntologySchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
    throw new OntologyError(`invalid ontology ${source}:\n${lines.join("\n")}`);
  }
  return result.data;
}
