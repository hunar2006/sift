export interface CoverageData {
  artifactPath: string;
  format: "lcov" | "cobertura";
  stale: boolean;
  files: Map<string, Map<number, number>>;
}
