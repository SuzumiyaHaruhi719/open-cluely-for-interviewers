import { describe, expect, test } from 'vitest';
import {
  JOB_PROFILES,
  PROPERTY_MANAGER_PROFILE,
  USER_OPERATIONS_P7_PROFILE,
  USER_OPERATIONS_P8_PROFILE,
  buildInterviewGuideLines,
  searchJobProfiles
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

  test('fuzzy-searches built-in JDs across role, organization, and responsibilities', () => {
    expect(searchJobProfiles('园区 管理').map((profile) => profile.id)).toContain('property-manager');
    expect(searchJobProfiles('城市负责人').map((profile) => profile.id)).toContain('property-manager');
    expect(searchJobProfiles('物经').map((profile) => profile.id)).toContain('property-manager');
    expect(searchJobProfiles('量子芯片设计')).toEqual([]);
  });
});

describe('User Operations P7/P8 job profiles', () => {
  test('keeps P7 and P8 as complete independent Expert contexts', () => {
    expect(USER_OPERATIONS_P7_PROFILE).toMatchObject({
      id: 'user-operations-p7',
      title: '用户运营专家（P7）',
      department: '用户运营 / 增长与体验',
      reportsTo: '用户运营负责人'
    });
    expect(USER_OPERATIONS_P8_PROFILE).toMatchObject({
      id: 'user-operations-p8',
      title: '用户运营专家（P8）',
      department: '用户运营 / 增长与体验',
      reportsTo: '业务负责人或用户运营负责人'
    });
    expect(USER_OPERATIONS_P7_PROFILE.jobDescription).toContain('独立负责一个复杂用户运营域');
    expect(USER_OPERATIONS_P7_PROFILE.jobDescription).toContain('增长实验');
    expect(USER_OPERATIONS_P8_PROFILE.jobDescription).toContain('跨业务、跨产品或跨区域');
    expect(USER_OPERATIONS_P8_PROFILE.jobDescription).toContain('资源优先级');
    expect(USER_OPERATIONS_P7_PROFILE.jobDescription).not.toContain('职位：用户运营专家（P8）');
    expect(USER_OPERATIONS_P8_PROFILE.jobDescription).not.toContain('职位：用户运营专家（P7）');
    expect(USER_OPERATIONS_P7_PROFILE.interviewGuide.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
    expect(USER_OPERATIONS_P8_PROFILE.interviewGuide.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
  });

  test('serializes complete level-specific evidence guides into Expert context', () => {
    const p7Lines = buildInterviewGuideLines(USER_OPERATIONS_P7_PROFILE);
    const p8Lines = buildInterviewGuideLines(USER_OPERATIONS_P8_PROFILE);

    expect(p7Lines).toHaveLength(9);
    expect(p8Lines).toHaveLength(9);
    expect(p7Lines.join('\n')).toContain('独立担当与结果所有权');
    expect(p8Lines.join('\n')).toContain('跨域战略与组合取舍');
    expect(p7Lines.join('\n')).toContain('可验证证据');
    expect(p8Lines.join('\n')).toContain('警示信号');
    for (const profile of [USER_OPERATIONS_P7_PROFILE, USER_OPERATIONS_P8_PROFILE]) {
      for (const item of profile.interviewGuide) {
        expect(item.primaryQuestion.length).toBeGreaterThan(12);
        expect(item.followUps.length).toBeGreaterThanOrEqual(2);
        expect(item.evidenceSignals.length).toBeGreaterThanOrEqual(2);
        expect(item.redFlags.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test('fuzzy search distinguishes levels and returns both for generic intent', () => {
    expect(searchJobProfiles('P7').map((profile) => profile.id)).toEqual(['user-operations-p7']);
    expect(searchJobProfiles('P8').map((profile) => profile.id)).toEqual(['user-operations-p8']);
    expect(searchJobProfiles('用户运营').map((profile) => profile.id)).toEqual(
      expect.arrayContaining(['user-operations-p7', 'user-operations-p8'])
    );
    expect(searchJobProfiles('增长 专家').map((profile) => profile.id)).toEqual(
      expect.arrayContaining(['user-operations-p7', 'user-operations-p8'])
    );
    expect(JOB_PROFILES.map((profile) => profile.id)).toEqual(
      expect.arrayContaining(['property-manager', 'user-operations-p7', 'user-operations-p8'])
    );
  });
});
