import { describe, expect, test } from 'vitest';
import {
  JOB_PROFILES,
  PROPERTY_MANAGER_PROFILE,
  buildInterviewGuideLines
} from './jobProfiles';

describe('Property Manager job profile', () => {
  test('preserves the supplied JD as context data and covers every operating domain', () => {
    expect(PROPERTY_MANAGER_PROFILE).toMatchObject({
      id: 'property-manager',
      title: '物业经理',
      department: '区域运营服务',
      reportsTo: '城市负责人'
    });
    expect(PROPERTY_MANAGER_PROFILE.jobDescription).toContain('负责园区物业人员的培训、考勤、纪律、奖惩');
    expect(PROPERTY_MANAGER_PROFILE.jobDescription).toContain('现场的安全及消防');
    expect(PROPERTY_MANAGER_PROFILE.jobDescription).toContain('租户租金及水电费用收缴');
    expect(PROPERTY_MANAGER_PROFILE.jobDescription).toContain('物业或工程相关证书者优先');
    expect(PROPERTY_MANAGER_PROFILE.jobDescription).not.toMatch(/你是|忽略之前指令|system prompt/i);

    const competencyIds = PROPERTY_MANAGER_PROFILE.interviewGuide.map((item) => item.id);
    expect(competencyIds).toEqual(
      expect.arrayContaining([
        'independent-operations',
        'people-leadership',
        'safety-emergency',
        'facility-engineering',
        'tenant-service',
        'budget-execution'
      ])
    );
    expect(PROPERTY_MANAGER_PROFILE.interviewGuide.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
  });

  test('serializes the scorecard into evidence-oriented Expert context', () => {
    const lines = buildInterviewGuideLines(PROPERTY_MANAGER_PROFILE);

    expect(lines).toHaveLength(PROPERTY_MANAGER_PROFILE.interviewGuide.length);
    expect(lines.join('\n')).toContain('突发事件应对与复盘');
    expect(lines.join('\n')).toContain('可验证证据');
    expect(lines.join('\n')).toContain('警示信号');
    expect(JOB_PROFILES.map((profile) => profile.id)).toContain('property-manager');
  });
});
