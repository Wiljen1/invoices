import "dotenv/config";

export type NetSuiteAuthMode = "oauth2" | "tba";

export interface ServerConfig {
  port: number;
  clientOrigin: string;
  netsuite: {
    accountId: string;
    realm: string;
    restBaseUrl: string;
    authMode: NetSuiteAuthMode;
    oauth2: {
      accessToken?: string;
      clientId?: string;
      clientSecret?: string;
      tokenUrl?: string;
      scope?: string;
      grantType?: string;
      clientAssertion?: string;
      clientAssertionType?: string;
    };
    tba: {
      consumerKey?: string;
      consumerSecret?: string;
      tokenId?: string;
      tokenSecret?: string;
    };
  };
}

function env(name: string, fallback = "") {
  return (process.env[name] ?? fallback).trim();
}

function defaultRestBaseUrl(accountId: string) {
  if (!accountId) return "";
  return `https://${accountId.toLowerCase().replaceAll("_", "-")}.suitetalk.api.netsuite.com`;
}

export function getServerConfig(): ServerConfig {
  const accountId = env("NETSUITE_ACCOUNT_ID");
  const authMode = env("NETSUITE_AUTH_MODE", "oauth2").trim().toLowerCase() === "tba" ? "tba" : "oauth2";

  return {
    port: Number(env("PORT", "3001")),
    clientOrigin: env("CLIENT_ORIGIN", "http://localhost:5173"),
    netsuite: {
      accountId,
      realm: env("NETSUITE_REALM", accountId),
      restBaseUrl: env("NETSUITE_REST_BASE_URL", defaultRestBaseUrl(accountId)),
      authMode,
      oauth2: {
        accessToken: env("NETSUITE_OAUTH2_ACCESS_TOKEN") || undefined,
        clientId: env("NETSUITE_OAUTH2_CLIENT_ID") || undefined,
        clientSecret: env("NETSUITE_OAUTH2_CLIENT_SECRET") || undefined,
        tokenUrl: env("NETSUITE_OAUTH2_TOKEN_URL") || undefined,
        scope: env("NETSUITE_OAUTH2_SCOPE") || undefined,
        grantType: env("NETSUITE_OAUTH2_GRANT_TYPE", "client_credentials") || undefined,
        clientAssertion: env("NETSUITE_OAUTH2_CLIENT_ASSERTION") || undefined,
        clientAssertionType:
          env(
            "NETSUITE_OAUTH2_CLIENT_ASSERTION_TYPE",
            "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
          ) || undefined
      },
      tba: {
        consumerKey: env("NETSUITE_TBA_CONSUMER_KEY") || undefined,
        consumerSecret: env("NETSUITE_TBA_CONSUMER_SECRET") || undefined,
        tokenId: env("NETSUITE_TBA_TOKEN_ID") || undefined,
        tokenSecret: env("NETSUITE_TBA_TOKEN_SECRET") || undefined
      }
    }
  };
}
