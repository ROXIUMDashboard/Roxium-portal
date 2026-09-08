import '@testing-library/jest-dom/vitest';

// Tests always run against the in-process driver with a known link, so no
// credentials are needed and no external service is touched.
process.env.PROGRAM_DATA_DRIVER = 'memory';
process.env.SEED_COLLAB_TOKEN ||= 'test_token_test_token_test_token_test_token';
process.env.COLLAB_TOKEN_PEPPER ||= 'test-pepper';
