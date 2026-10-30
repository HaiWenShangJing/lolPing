/**
 * The heroes of the Sanguosha table: who they are (historical figures of the Three Kingdoms), how many hit points they
 * have and which skills they hold. What a skill does is in `sanguoshaSkills.ts` and the places it is called from, and
 * what it is called and how it reads is in the words of each language.
 */

export const KINGDOMS = ['shu', 'wei', 'wu', 'qun'] as const;
export type Kingdom = (typeof KINGDOMS)[number];

export const SKILLS = [
  'rende', 'wusheng', 'paoxiao', 'guanxing', 'kongcheng', 'longdan', 'mashu', 'tieqi', 'jizhi', 'qicai',
  'jianxiong', 'fankui', 'guicai', 'ganglie', 'tuxi', 'luoyi', 'tiandu', 'yiji', 'luoshen', 'qingguo',
  'zhiheng', 'keji', 'kurou', 'yingzi', 'qixi', 'guose', 'qianxun', 'lianying', 'xiaoji',
  'qingnang', 'jijiu', 'wushuang', 'biyue',
] as const;
export type SkillId = (typeof SKILLS)[number];

/** The skills a player starts by choosing in his own play phase, from a button of their own. */
export const ACTIVE_SKILLS = ['rende', 'zhiheng', 'kurou', 'qingnang'] as const;
export type ActiveSkill = (typeof ACTIVE_SKILLS)[number];
export const isActiveSkill = (skill: SkillId): skill is ActiveSkill => (ACTIVE_SKILLS as readonly string[]).includes(skill);

export const HERO_IDS = [
  'liubei', 'guanyu', 'zhangfei', 'zhugeliang', 'zhaoyun', 'machao', 'huangyueying',
  'caocao', 'simayi', 'xiahoudun', 'zhangliao', 'xuchu', 'guojia', 'zhenji',
  'sunquan', 'lvmeng', 'huanggai', 'zhouyu', 'ganning', 'daqiao', 'luxun', 'sunshangxiang',
  'huatuo', 'lvbu', 'diaochan',
] as const;
export type HeroId = (typeof HERO_IDS)[number];
export const isHeroId = (raw: unknown): raw is HeroId => (HERO_IDS as readonly unknown[]).includes(raw);

export interface Hero {
  kingdom: Kingdom;
  hp: number;
  skills: readonly SkillId[];
}

export const HEROES: Record<HeroId, Hero> = {
  liubei: { kingdom: 'shu', hp: 4, skills: ['rende'] },
  guanyu: { kingdom: 'shu', hp: 4, skills: ['wusheng'] },
  zhangfei: { kingdom: 'shu', hp: 4, skills: ['paoxiao'] },
  zhugeliang: { kingdom: 'shu', hp: 3, skills: ['guanxing', 'kongcheng'] },
  zhaoyun: { kingdom: 'shu', hp: 4, skills: ['longdan'] },
  machao: { kingdom: 'shu', hp: 4, skills: ['mashu', 'tieqi'] },
  huangyueying: { kingdom: 'shu', hp: 3, skills: ['jizhi', 'qicai'] },
  caocao: { kingdom: 'wei', hp: 4, skills: ['jianxiong'] },
  simayi: { kingdom: 'wei', hp: 3, skills: ['fankui', 'guicai'] },
  xiahoudun: { kingdom: 'wei', hp: 4, skills: ['ganglie'] },
  zhangliao: { kingdom: 'wei', hp: 4, skills: ['tuxi'] },
  xuchu: { kingdom: 'wei', hp: 4, skills: ['luoyi'] },
  guojia: { kingdom: 'wei', hp: 3, skills: ['tiandu', 'yiji'] },
  zhenji: { kingdom: 'wei', hp: 3, skills: ['luoshen', 'qingguo'] },
  sunquan: { kingdom: 'wu', hp: 4, skills: ['zhiheng'] },
  lvmeng: { kingdom: 'wu', hp: 4, skills: ['keji'] },
  huanggai: { kingdom: 'wu', hp: 4, skills: ['kurou'] },
  zhouyu: { kingdom: 'wu', hp: 3, skills: ['yingzi'] },
  ganning: { kingdom: 'wu', hp: 4, skills: ['qixi'] },
  daqiao: { kingdom: 'wu', hp: 3, skills: ['guose'] },
  luxun: { kingdom: 'wu', hp: 3, skills: ['qianxun', 'lianying'] },
  sunshangxiang: { kingdom: 'wu', hp: 3, skills: ['xiaoji'] },
  huatuo: { kingdom: 'qun', hp: 3, skills: ['qingnang', 'jijiu'] },
  lvbu: { kingdom: 'qun', hp: 4, skills: ['wushuang'] },
  diaochan: { kingdom: 'qun', hp: 3, skills: ['biyue'] },
};
