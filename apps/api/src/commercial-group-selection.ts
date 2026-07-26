import type { WhatsAppGroupRecord } from './repositories';

export const COMMERCIAL_GROUP_FINGERPRINT = /^grp_[a-f0-9]{12}$/;

export const isCommercialAuthorizedGroup = (
  group: WhatsAppGroupRecord,
  instanceName: string,
) =>
  group.type === 'GROUP' &&
  group.active === true &&
  group.available === true &&
  group.sourceInstanceName === instanceName &&
  COMMERCIAL_GROUP_FINGERPRINT.test(group.fingerprint);
