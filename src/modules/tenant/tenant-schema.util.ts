const SCHEMA_PREFIX = 'org_';

export function schemaNameFor(organizationId: string): string {
  return `${SCHEMA_PREFIX}${organizationId.replace(/-/g, '')}`;
}

export function isTenantSchemaName(schemaName: string): boolean {
  return schemaName.startsWith(SCHEMA_PREFIX);
}
