/** リポジトリ直下の ontology.yaml をビルド時に同梱し、モジュールロード時に 1 回だけ検証する。 */
import raw from "../../ontology.yaml";

import { loadOntology } from "./load";

export const ONTOLOGY = loadOntology(raw);
