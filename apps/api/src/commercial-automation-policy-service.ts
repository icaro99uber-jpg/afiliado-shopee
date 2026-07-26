import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { isCommercialAuthorizedGroup } from './commercial-group-selection';
import type {
  CommercialAutomationHistoryRepository,
  CommercialAutomationSettingsRecord,
  CommercialAutomationSettingsRepository,
  WhatsAppGroupDirectoryRepository,
} from './repositories';

export const COMMERCIAL_AUTOMATION_RESUME_CONFIRMATION =
  'RETOMAR_AUTOMACAO_COMERCIAL';

export const COMMERCIAL_AUTOMATION_REASONS = [
  'AUTOMATION_DISABLED',
  'AUTOMATION_PAUSED',
  'OUTSIDE_ALLOWED_WINDOW',
  'GLOBAL_DAILY_LIMIT_REACHED',
  'GROUP_DAILY_LIMIT_REACHED',
  'MINIMUM_INTERVAL_NOT_REACHED',
  'NO_AUTHORIZED_GROUP',
  'MULTIPLE_AUTHORIZED_GROUPS',
  'AMBIGUOUS_COMMERCIAL_RUN_EXISTS',
] as const;

export type CommercialAutomationReason =
  (typeof COMMERCIAL_AUTOMATION_REASONS)[number];

export type CommercialAutomationPolicyConfig = {
  enabled: boolean;
  timezone: string;
  allowedStartTime: string;
  allowedEndTime: string;
  dailyGlobalLimit: number;
  dailyGroupLimit: number;
  minimumIntervalMinutes: number;
};

export type CommercialAutomationStatus = {
  enabled: boolean;
  allowed: boolean;
  reasons: CommercialAutomationReason[];
  nextAllowedAt: string | null;
  globalSentToday: number;
  globalRemainingToday: number;
  groupSentToday: number;
  groupRemainingToday: number;
  lastSentAt: string | null;
  paused: boolean;
  pausedAt: string | null;
  resumedAt: string | null;
  updatedAt: string;
  allowedStartTime: string;
  allowedEndTime: string;
  timezone: string;
  dailyGlobalLimit: number;
  dailyGroupLimit: number;
  minimumIntervalMinutes: number;
  authorizedGroupCount: number;
};

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

const getFormatter = (timezone: string) => {
  let formatter = dateTimeFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dateTimeFormatters.set(timezone, formatter);
  }
  return formatter;
};

const getZonedParts = (date: Date, timezone: string): ZonedDateParts => {
  const values = Object.fromEntries(
    getFormatter(timezone)
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
};

const parseTime = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};

const isInsideAllowedWindow = (
  date: Date,
  timezone: string,
  startTime: string,
  endTime: string,
) => {
  const parts = getZonedParts(date, timezone);
  const current = parts.hour * 60 + parts.minute;
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
};

const nextWindowOpeningAtOrAfter = (
  date: Date,
  timezone: string,
  startTime: string,
  endTime: string,
) => {
  if (isInsideAllowedWindow(date, timezone, startTime, endTime)) return date;

  let candidate = Math.ceil(date.getTime() / 60_000) * 60_000;
  if (candidate <= date.getTime()) candidate += 60_000;
  for (let minute = 0; minute < 72 * 60; minute += 1) {
    const instant = new Date(candidate + minute * 60_000);
    if (isInsideAllowedWindow(instant, timezone, startTime, endTime)) {
      return instant;
    }
  }
  throw new Error('Nao foi possivel calcular a proxima janela comercial');
};

const getLocalDayRange = (now: Date, timezone: string) => {
  const today = getZonedParts(now, timezone);
  const dateKey = `${today.year}-${today.month}-${today.day}`;
  const isSameLocalDay = (timestamp: number) => {
    const parts = getZonedParts(new Date(timestamp), timezone);
    return `${parts.year}-${parts.month}-${parts.day}` === dateKey;
  };
  const findBoundary = (direction: -1 | 1) => {
    const step = direction * 6 * 60 * 60_000;
    let inside = now.getTime();
    let outside = inside + step;
    while (isSameLocalDay(outside)) {
      inside = outside;
      outside += step;
    }
    let lower = Math.min(inside, outside);
    let upper = Math.max(inside, outside);
    while (upper - lower > 1) {
      const middle = Math.floor((lower + upper) / 2);
      if (isSameLocalDay(middle) === (direction === -1)) upper = middle;
      else lower = middle;
    }
    return new Date(upper);
  };
  return {
    dayStartsAt: findBoundary(-1),
    dayEndsAt: findBoundary(1),
  };
};

const isoOrNull = (date: Date | null) => date?.toISOString() ?? null;

const HARD_BLOCKING_REASONS = new Set<CommercialAutomationReason>([
  'AUTOMATION_DISABLED',
  'AUTOMATION_PAUSED',
  'NO_AUTHORIZED_GROUP',
  'MULTIPLE_AUTHORIZED_GROUPS',
  'AMBIGUOUS_COMMERCIAL_RUN_EXISTS',
]);

export class CommercialAutomationPolicyService {
  constructor(
    private readonly dependencies: {
      settings: CommercialAutomationSettingsRepository;
      history: CommercialAutomationHistoryRepository;
      groups: Pick<WhatsAppGroupDirectoryRepository, 'list'>;
      instanceName: string;
      config: CommercialAutomationPolicyConfig;
      clock?: () => Date;
    },
  ) {}

  async evaluateAutomationReadiness(): Promise<CommercialAutomationStatus> {
    const now = (this.dependencies.clock ?? (() => new Date()))();
    const [settings, context] = await Promise.all([
      this.dependencies.settings.getOrCreate(now),
      this.loadOperationalContext(now),
    ]);

    return this.buildStatus({ now, settings, ...context });
  }

  private async loadOperationalContext(now: Date) {
    const dayRange = getLocalDayRange(now, this.dependencies.config.timezone);
    const [groups, ambiguousExecution] = await Promise.all([
      this.dependencies.groups.list(this.dependencies.instanceName, {
        active: true,
        available: true,
      }),
      this.dependencies.history.hasAmbiguousCommercialExecution(),
    ]);
    const authorizedGroups = groups.filter((group) =>
      isCommercialAuthorizedGroup(group, this.dependencies.instanceName),
    );
    const selectedGroup =
      authorizedGroups.length === 1 ? authorizedGroups[0] : undefined;
    const history = await this.dependencies.history.getSnapshot({
      groupId: selectedGroup?.id,
      ...dayRange,
    });
    return {
      authorizedGroupCount: authorizedGroups.length,
      ambiguousExecution,
      history,
      dayEndsAt: dayRange.dayEndsAt,
    };
  }

  async setPaused(input: {
    paused: boolean;
    confirmation?: string;
  }): Promise<CommercialAutomationStatus> {
    if (
      !input.paused &&
      input.confirmation !== COMMERCIAL_AUTOMATION_RESUME_CONFIRMATION
    ) {
      throw new AppError(
        'Confirmacao explicita obrigatoria para retomar a automacao',
        'COMMERCIAL_AUTOMATION_RESUME_CONFIRMATION_REQUIRED',
      );
    }
    const now = (this.dependencies.clock ?? (() => new Date()))();
    const context = await this.loadOperationalContext(now);
    const settings = await this.dependencies.settings.setPaused(
      input.paused,
      now,
    );
    return this.buildStatus({ now, settings, ...context });
  }

  private buildStatus({
    now,
    settings,
    authorizedGroupCount,
    ambiguousExecution,
    history,
    dayEndsAt,
  }: {
    now: Date;
    settings: CommercialAutomationSettingsRecord;
    authorizedGroupCount: number;
    ambiguousExecution: boolean;
    history: {
      globalSentToday: number;
      groupSentToday: number;
      lastSentAt: Date | null;
    };
    dayEndsAt: Date;
  }): CommercialAutomationStatus {
    const { config } = this.dependencies;
    const reasons: CommercialAutomationReason[] = [];
    const outsideWindow = !isInsideAllowedWindow(
      now,
      config.timezone,
      config.allowedStartTime,
      config.allowedEndTime,
    );
    const globalLimitReached =
      history.globalSentToday >= config.dailyGlobalLimit;
    const groupLimitReached = history.groupSentToday >= config.dailyGroupLimit;
    const intervalEndsAt = history.lastSentAt
      ? new Date(
          history.lastSentAt.getTime() + config.minimumIntervalMinutes * 60_000,
        )
      : null;
    const minimumIntervalNotReached = Boolean(
      intervalEndsAt && intervalEndsAt > now,
    );

    if (!config.enabled) reasons.push('AUTOMATION_DISABLED');
    if (settings.paused) reasons.push('AUTOMATION_PAUSED');
    if (outsideWindow) reasons.push('OUTSIDE_ALLOWED_WINDOW');
    if (globalLimitReached) reasons.push('GLOBAL_DAILY_LIMIT_REACHED');
    if (groupLimitReached) reasons.push('GROUP_DAILY_LIMIT_REACHED');
    if (minimumIntervalNotReached) reasons.push('MINIMUM_INTERVAL_NOT_REACHED');
    if (authorizedGroupCount === 0) reasons.push('NO_AUTHORIZED_GROUP');
    if (authorizedGroupCount > 1) reasons.push('MULTIPLE_AUTHORIZED_GROUPS');
    if (ambiguousExecution) reasons.push('AMBIGUOUS_COMMERCIAL_RUN_EXISTS');

    let nextAllowedAt: Date | null = null;
    if (
      reasons.length > 0 &&
      !reasons.some((reason) => HARD_BLOCKING_REASONS.has(reason))
    ) {
      const candidates: Date[] = [];
      if (outsideWindow) {
        candidates.push(
          nextWindowOpeningAtOrAfter(
            now,
            config.timezone,
            config.allowedStartTime,
            config.allowedEndTime,
          ),
        );
      }
      if (globalLimitReached || groupLimitReached) candidates.push(dayEndsAt);
      if (minimumIntervalNotReached && intervalEndsAt)
        candidates.push(intervalEndsAt);
      const latest = new Date(
        Math.max(...candidates.map((candidate) => candidate.getTime())),
      );
      nextAllowedAt = nextWindowOpeningAtOrAfter(
        latest,
        config.timezone,
        config.allowedStartTime,
        config.allowedEndTime,
      );
    }

    return {
      enabled: config.enabled,
      allowed: reasons.length === 0,
      reasons,
      nextAllowedAt: isoOrNull(nextAllowedAt),
      globalSentToday: history.globalSentToday,
      globalRemainingToday: Math.max(
        0,
        config.dailyGlobalLimit - history.globalSentToday,
      ),
      groupSentToday: history.groupSentToday,
      groupRemainingToday: Math.max(
        0,
        config.dailyGroupLimit - history.groupSentToday,
      ),
      lastSentAt: isoOrNull(history.lastSentAt),
      paused: settings.paused,
      pausedAt: isoOrNull(settings.pausedAt),
      resumedAt: isoOrNull(settings.resumedAt),
      updatedAt: settings.updatedAt.toISOString(),
      allowedStartTime: config.allowedStartTime,
      allowedEndTime: config.allowedEndTime,
      timezone: config.timezone,
      dailyGlobalLimit: config.dailyGlobalLimit,
      dailyGroupLimit: config.dailyGroupLimit,
      minimumIntervalMinutes: config.minimumIntervalMinutes,
      authorizedGroupCount,
    };
  }
}
