import createClient from "openapi-fetch";
import type { paths } from "./schema";

/** Typed client for client components. Same-origin ("" base URL): requests go through the web app's /api proxy. */
export const browserApi = createClient<paths>({ baseUrl: "" });

/** Admin writes must carry the CSRF token that login returned. */
export const adminHeaders = (csrf: string) => ({ "X-CSRF-Token": csrf });
