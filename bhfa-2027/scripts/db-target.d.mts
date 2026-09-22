/** Types for db-target.mjs, which is plain ESM so the deploy step can run it without a build. */
export declare const FORBIDDEN_REFS: string[];
export declare function refFromConnectionString(connectionString: string): string | null;
export declare function assertBhfaTarget(connectionString: string, expectedRef: string | undefined): string;
