import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const client = createClient({
	url: process.env.DATABASE_URL ?? "file:./dev.db",
});

await client.executeMultiple(`
CREATE TABLE IF NOT EXISTS user (
	id TEXT PRIMARY KEY NOT NULL,
	name TEXT NOT NULL,
	email TEXT NOT NULL UNIQUE,
	emailVerified INTEGER NOT NULL,
	image TEXT,
	createdAt INTEGER NOT NULL,
	updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
	id TEXT PRIMARY KEY NOT NULL,
	expiresAt INTEGER NOT NULL,
	token TEXT NOT NULL UNIQUE,
	createdAt INTEGER NOT NULL,
	updatedAt INTEGER NOT NULL,
	ipAddress TEXT,
	userAgent TEXT,
	userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	activeOrganizationId TEXT,
	activeTeamId TEXT
);
CREATE INDEX IF NOT EXISTS session_userId_idx ON session(userId);

CREATE TABLE IF NOT EXISTS account (
	id TEXT PRIMARY KEY NOT NULL,
	accountId TEXT NOT NULL,
	providerId TEXT NOT NULL,
	userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	accessToken TEXT,
	refreshToken TEXT,
	idToken TEXT,
	accessTokenExpiresAt INTEGER,
	refreshTokenExpiresAt INTEGER,
	scope TEXT,
	password TEXT,
	createdAt INTEGER NOT NULL,
	updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_userId_idx ON account(userId);

CREATE TABLE IF NOT EXISTS verification (
	id TEXT PRIMARY KEY NOT NULL,
	identifier TEXT NOT NULL,
	value TEXT NOT NULL,
	expiresAt INTEGER NOT NULL,
	createdAt INTEGER NOT NULL,
	updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);

CREATE TABLE IF NOT EXISTS organization (
	id TEXT PRIMARY KEY NOT NULL,
	name TEXT NOT NULL,
	slug TEXT NOT NULL UNIQUE,
	logo TEXT,
	metadata TEXT,
	createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS member (
	id TEXT PRIMARY KEY NOT NULL,
	organizationId TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
	userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	role TEXT NOT NULL,
	createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS member_organizationId_idx ON member(organizationId);
CREATE INDEX IF NOT EXISTS member_userId_idx ON member(userId);

CREATE TABLE IF NOT EXISTS invitation (
	id TEXT PRIMARY KEY NOT NULL,
	organizationId TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
	email TEXT NOT NULL,
	role TEXT,
	status TEXT NOT NULL,
	expiresAt INTEGER NOT NULL,
	inviterId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS invitation_organizationId_idx ON invitation(organizationId);
CREATE INDEX IF NOT EXISTS invitation_email_idx ON invitation(email);

CREATE TABLE IF NOT EXISTS team (
	id TEXT PRIMARY KEY NOT NULL,
	name TEXT NOT NULL,
	organizationId TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
	createdAt INTEGER NOT NULL,
	updatedAt INTEGER
);
CREATE INDEX IF NOT EXISTS team_organizationId_idx ON team(organizationId);

CREATE TABLE IF NOT EXISTS teamMember (
	teamId TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
	userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	createdAt INTEGER
);
CREATE INDEX IF NOT EXISTS teamMember_teamId_idx ON teamMember(teamId);
CREATE INDEX IF NOT EXISTS teamMember_userId_idx ON teamMember(userId);

CREATE TABLE IF NOT EXISTS guapocadoWebhookEndpoint (
	id TEXT PRIMARY KEY NOT NULL,
	url TEXT NOT NULL,
	events TEXT NOT NULL,
	status TEXT NOT NULL,
	signingSecret TEXT NOT NULL,
	createdAt INTEGER NOT NULL,
	updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guapocadoWebhookEvent (
	id TEXT PRIMARY KEY NOT NULL,
	type TEXT NOT NULL,
	payload TEXT NOT NULL,
	signature TEXT,
	receivedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS guapocadoWebhookEvent_type_idx ON guapocadoWebhookEvent(type);
`);

for (const column of ["activeOrganizationId", "activeTeamId"]) {
	try {
		await client.execute(`ALTER TABLE session ADD COLUMN ${column} TEXT`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!message.toLowerCase().includes("duplicate column")) throw error;
	}
}

export const db = drizzle(client, { schema });
export { schema };
