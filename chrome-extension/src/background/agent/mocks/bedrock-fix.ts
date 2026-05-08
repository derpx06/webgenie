export const loadSharedConfigFiles = async () => ({
  configFile: {},
  credentialsFile: {},
});
export const ENV_PROFILE = "AWS_PROFILE";
export const CONFIG_PREFIX_SEPARATOR = ".";
export const defaultProvider = () => async () => ({
  accessKeyId: "mock",
  secretAccessKey: "mock",
});
export const fromEnv = () => async () => ({
  accessKeyId: "mock",
  secretAccessKey: "mock",
});
export const ENV_KEY = "AWS_ACCESS_KEY_ID";
export const ENV_SECRET = "AWS_SECRET_ACCESS_KEY";
export const ENV_SESSION = "AWS_SESSION_TOKEN";
export const ENV_EXPIRATION = "AWS_CREDENTIAL_EXPIRATION";
