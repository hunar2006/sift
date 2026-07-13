export type RuleScope = "global" | "repo";

export interface UserRule {
  id: string;
  message: string;
  paths: string[];
  exclude: string[];
  pattern?: string;
  weight: number;
  tier: "primary" | "nit";
  source: string;
}

export interface RuleAdjustment {
  code: string;
  paths?: string[];
  exclude: string[];
  weight: number;
  source: string;
}

export interface EffectiveRules {
  rules: UserRule[];
  adjust: RuleAdjustment[];
}

export interface RuleFileReport {
  scope: RuleScope;
  path: string;
  status: "ok" | "missing" | "error";
  error?: string;
}

export interface LoadedRules {
  rules: EffectiveRules;
  reports: RuleFileReport[];
}
