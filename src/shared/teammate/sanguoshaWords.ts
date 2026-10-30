/**
 * What the Sanguosha window says in each language: the lobby, the labels of the table, the questions put to the user,
 * the lines of the log, and what every card, hero and skill is called and does. The rules text is this game's own
 * wording, not the printed game's.
 */
import type { CardName } from './sanguoshaCards';
import type { HeroId, Kingdom, SkillId } from './sanguoshaHeroes';
import type { ConfirmWhy, Phase, Role } from './sanguoshaTypes';

export interface Named {
  name: string;
  tip: string;
}

const enCard: Record<CardName, Named> = {
  sha: { name: 'Strike', tip: 'Play it in your turn at a player within reach: they must play a Dodge or lose 1 HP. One a turn.' },
  shan: { name: 'Dodge', tip: 'Play it when a Strike or an Arrow Volley is aimed at you, and it misses.' },
  tao: { name: 'Peach', tip: 'Heal 1 HP in your turn, or play it out of turn to pull a dying player back.' },
  juedou: { name: 'Duel', tip: 'Pick a player. You and they play Strikes in turn, they first. Whoever cannot loses 1 HP.' },
  chai: { name: 'Dismantle', tip: 'Pick a player and discard one card of theirs: a hand card (blind), a piece of equipment or a waiting trick.' },
  shun: { name: 'Snatch', tip: 'Take one card of a player at distance 1: a hand card (blind), a piece of equipment or a waiting trick.' },
  wuzhong: { name: 'Windfall', tip: 'Draw 2 cards.' },
  nanman: { name: 'Barbarian Raid', tip: 'Every other player must play a Strike or lose 1 HP.' },
  wanjian: { name: 'Arrow Volley', tip: 'Every other player must play a Dodge or lose 1 HP.' },
  taoyuan: { name: 'Peach Garden Oath', tip: 'Every wounded player heals 1 HP.' },
  wuxie: { name: 'Counter', tip: 'Play it as a trick takes effect on a player, to cancel it for them. A Counter can be countered.' },
  lebu: { name: 'Idle Pleasure', tip: 'Place it before another player. In their judgement phase they flip a card; unless it is a heart, they skip their play phase.' },
  bing: { name: 'Supply Cut', tip: 'Place it before a player at distance 1. In their judgement phase they flip a card; unless it is a club, they skip their draw phase.' },
  shandian: { name: 'Lightning', tip: 'Place it before yourself. At each judgement, a spade from 2 to 9 deals its holder 3 damage; any other card passes it to the next player.' },
  zhuge: { name: 'Repeating Crossbow', tip: 'Weapon, range 1. You may play any number of Strikes a turn.' },
  qinggang: { name: 'Azure Sword', tip: 'Weapon, range 2. Your Strikes ignore the target’s armour.' },
  qinglong: { name: 'Green Dragon Blade', tip: 'Weapon, range 3. When your Strike is dodged, you may play another Strike at the same target.' },
  guanshi: { name: 'Stone-Cleaving Axe', tip: 'Weapon, range 3. When your Strike is dodged, you may discard 2 cards to hit anyway.' },
  fangtian: { name: 'Sky Halberd', tip: 'Weapon, range 4. A Strike that is your last hand card may aim at up to 3 players.' },
  qilin: { name: 'Qilin Bow', tip: 'Weapon, range 5. When your Strike hits, you may discard one of the target’s horses.' },
  bagua: { name: 'Eight Trigrams', tip: 'Armour. When you need a Dodge, you may flip a card: a red one counts as a Dodge.' },
  renwang: { name: 'Benevolent Shield', tip: 'Armour. Black Strikes have no effect on you.' },
  dilu: { name: 'Dilu', tip: 'Horse +1: other players need one more step to reach you.' },
  jueying: { name: 'Jueying', tip: 'Horse +1: other players need one more step to reach you.' },
  zhuahuang: { name: 'Zhuahuang', tip: 'Horse +1: other players need one more step to reach you.' },
  chitu: { name: 'Red Hare', tip: 'Horse −1: you need one step less to reach the other players.' },
  dawan: { name: 'Dawan', tip: 'Horse −1: you need one step less to reach the other players.' },
  zixing: { name: 'Zixing', tip: 'Horse −1: you need one step less to reach the other players.' },
};

const enHero: Record<HeroId, string> = {
  liubei: 'Liu Bei', guanyu: 'Guan Yu', zhangfei: 'Zhang Fei', zhugeliang: 'Zhuge Liang', zhaoyun: 'Zhao Yun',
  machao: 'Ma Chao', huangyueying: 'Huang Yueying', caocao: 'Cao Cao', simayi: 'Sima Yi', xiahoudun: 'Xiahou Dun',
  zhangliao: 'Zhang Liao', xuchu: 'Xu Chu', guojia: 'Guo Jia', zhenji: 'Zhen Ji', sunquan: 'Sun Quan', lvmeng: 'Lü Meng',
  huanggai: 'Huang Gai', zhouyu: 'Zhou Yu', ganning: 'Gan Ning', daqiao: 'Da Qiao', luxun: 'Lu Xun',
  sunshangxiang: 'Sun Shangxiang', huatuo: 'Hua Tuo', lvbu: 'Lü Bu', diaochan: 'Diaochan',
};

const enSkill: Record<SkillId, Named> = {
  rende: { name: 'Benevolence', tip: 'In your turn, give any number of hand cards to another player. The first time your gifts in a turn add up to 2 cards, heal 1 HP.' },
  wusheng: { name: 'War Saint', tip: 'You may play any red card as a Strike.' },
  paoxiao: { name: 'Roar', tip: 'You may play any number of Strikes a turn.' },
  guanxing: { name: 'Stargazing', tip: 'At the start of your turn, look at the top cards of the pile (as many as there are players, at most 5) and put any of them under the pile.' },
  kongcheng: { name: 'Empty Fort', tip: 'With no hand cards, you cannot be the target of a Strike or a Duel.' },
  longdan: { name: 'Dragon Heart', tip: 'You may play a Strike as a Dodge and a Dodge as a Strike.' },
  mashu: { name: 'Horsemanship', tip: 'You need one step less to reach every other player.' },
  tieqi: { name: 'Iron Cavalry', tip: 'When you play a Strike, flip a card: if it is red, the target cannot Dodge.' },
  jizhi: { name: 'Quick Wit', tip: 'Draw a card whenever you play a trick that takes effect at once.' },
  qicai: { name: 'Rare Talent', tip: 'Your tricks ignore distance.' },
  jianxiong: { name: 'Cunning Hero', tip: 'After you take damage, take the card or cards that dealt it.' },
  fankui: { name: 'Retort', tip: 'After you take damage from a player, take one card of theirs.' },
  guicai: { name: 'Ghostly Talent', tip: 'Before a judgement counts, you may play a hand card in place of the flipped card.' },
  ganglie: { name: 'Fierce Temper', tip: 'After you take damage from a player, flip a card: unless it is a heart, they discard 2 hand cards or lose 1 HP.' },
  tuxi: { name: 'Raid', tip: 'Instead of drawing, take one random hand card from each of up to 2 players.' },
  luoyi: { name: 'Bare Chest', tip: 'Draw 1 card less: until your turn ends, your Strikes and Duels deal 1 more damage.' },
  tiandu: { name: 'Heaven’s Envy', tip: 'Take the cards flipped for your judgements.' },
  yiji: { name: 'Legacy Plan', tip: 'After you take damage, draw 2 cards.' },
  luoshen: { name: 'Goddess of Luo', tip: 'At the start of your turn you may flip cards one at a time: keep each black card and flip again; a red one is discarded and ends it.' },
  qingguo: { name: 'Peerless Beauty', tip: 'You may play any black hand card as a Dodge.' },
  zhiheng: { name: 'Balance', tip: 'Once a turn, discard any number of cards (equipment too) and draw as many.' },
  keji: { name: 'Self-Restraint', tip: 'If you played no Strike in your turn, you skip the discard phase.' },
  kurou: { name: 'Bitter Flesh', tip: 'In your turn, lose 1 HP (while you have more than 1) to draw 2 cards.' },
  yingzi: { name: 'Heroic Poise', tip: 'You draw 1 extra card in your draw phase.' },
  qixi: { name: 'Sneak Attack', tip: 'You may play any black card as a Dismantle.' },
  guose: { name: 'National Beauty', tip: 'You may play any diamond card as Idle Pleasure.' },
  qianxun: { name: 'Humility', tip: 'You cannot be the target of Snatch or Idle Pleasure.' },
  lianying: { name: 'Linked Camps', tip: 'When your last hand card leaves your hand, draw 1 card.' },
  xiaoji: { name: 'Fierce Lady', tip: 'Whenever you lose a piece of equipment, draw 2 cards.' },
  qingnang: { name: 'Green Satchel', tip: 'Once a turn, discard a hand card to heal any wounded player 1 HP.' },
  jijiu: { name: 'First Aid', tip: 'Out of your own turn, you may play any red card as a Peach.' },
  wushuang: { name: 'Peerless', tip: 'Your Strikes need 2 Dodges; in a Duel the other side must play 2 Strikes each time.' },
  biyue: { name: 'Moon Veiled', tip: 'At the end of your turn, draw 1 card.' },
};

const enKingdom: Record<Kingdom, string> = { shu: 'Shu', wei: 'Wei', wu: 'Wu', qun: 'Qun' };

const enRole: Record<Role, string> = { lord: 'Lord', loyalist: 'Loyalist', rebel: 'Rebel', traitor: 'Traitor' };

const enRoleHint: Record<Role, string> = {
  lord: 'You start with 1 extra HP and play first. You win when every rebel and the traitor are out. The rebels win if you fall.',
  loyalist: 'Protect the lord. You win with the lord when every rebel and the traitor are out.',
  rebel: 'Bring the lord down. You win when the lord falls, unless the traitor is the only player left.',
  traitor: 'You win alone: be the only player left when the lord falls. If the lord falls while others are still in, the rebels win.',
};

const enPhase: Record<Phase, string> = {
  start: 'Start', judge: 'Judgement', draw: 'Draw', play: 'Play', discard: 'Discard', end: 'End',
};

const enConfirm: Record<ConfirmWhy, string> = {
  bagua: `${enCard.bagua.name}: flip a card; a red one counts as your Dodge. Use it?`,
  luoshen: `${enSkill.luoshen.name}: flip a card? Black cards are yours to keep; a red one is discarded and ends it.`,
  luoyi: `${enSkill.luoyi.name}: draw 1 card less to deal 1 extra damage with Strikes and Duels this turn?`,
};

/** The Sanguosha window's words. Cards, heroes and skills are named in one table each, the rest is lines and labels. */
export const enSanguosha = {
  title: 'Sanguosha',
  rules: 'Identity game for 5 or 8 players: one lord, loyalists, rebels and one traitor (5 players: 1 loyalist and 2 rebels; 8 players: 2 loyalists and 4 rebels). Only the lord’s role is open. Everyone picks a hero, the lord first, and draws 4 cards. A turn: draw 2 cards, play cards, then discard down to your HP. Killing a rebel draws 3 cards; a lord who kills a loyalist loses all his cards. An unofficial fan version with its own rules text and no official art. “Sanguosha” is the name of Yoka Games’ game.',
  size5: '5 players',
  size8: '8 players',
  pick: 'Pick up to {n} pets to sit with you. Empty seats are filled in.',
  bots: 'The pets play by rules of their own: no Copilot CLI is used and no quota is spent.',
  card: enCard,
  hero: enHero,
  skill: enSkill,
  kingdom: enKingdom,
  role: enRole,
  roleHint: enRoleHint,
  phase: enPhase,
  join: (items: string[]) => items.join(', '),
  /** A card named in a sentence, and the same with its suit and rank after it. */
  cardRef: (name: string) => name,
  cardTag: (name: string, tag: string) => `${name} ${tag}`,
  youAre: (role: string) => `You are the ${role}.`,
  turnNo: 'Turn {n}',
  pile: 'Pile {n}',
  hand: 'Hand {n}',
  dist: 'Distance {n}',
  range: 'Range {n}',
  out: 'Out',
  spectating: 'You are out. You can keep watching the game.',
  waiting: 'Waiting for the others…',
  yourTurn: 'Your turn',
  endTurn: 'End turn',
  ok: 'OK',
  cancel: 'Cancel',
  pass: 'Pass',
  yes: 'Yes',
  no: 'No',
  pickTarget: 'Pick a target.',
  pickTargets: 'Pick up to {n} targets, then press OK.',
  pickCards: 'Pick the cards, then press OK.',
  playAs: 'Play {card} as:',
  yourSkills: 'Your skills',
  hiddenCard: 'A hand card',
  ask: {
    hero: 'Pick your hero.',
    heroLord: 'You are the lord: pick your hero. The lord starts with 1 extra HP.',
    play: 'Your turn. Click a card to play it, or use a skill.',
    dodge: (from: string, card: string, need: number) =>
      `${card} from ${from}. Play a Dodge${need > 1 ? ` (${need} needed)` : ''} or take the hit.`,
    strike: (from: string, card: string, need: number) =>
      `${card} from ${from}. Play a Strike${need > 1 ? ` (${need} needed)` : ''} or lose 1 HP.`,
    peach: (victim: string, self: boolean) =>
      (self ? 'You are dying! Play a Peach to survive.' : `${victim} is dying. Play a Peach to save them?`),
    counter: (card: string, from: string | null, target: string | null, on: boolean) => {
      const what = from !== null && target !== null
        ? `${card} from ${from} is about to take effect on ${target}.`
        : from !== null
          ? `${card} from ${from} is about to take effect.`
          : target !== null ? `${card} is about to take effect on ${target}.` : `${card} is about to take effect.`;
      return `${what} ${on ? 'Play a Counter to cancel it?' : 'It is cancelled for now. Play a Counter to let it through?'}`;
    },
    discard: (n: number) => `Discard ${n} card${n === 1 ? '' : 's'}.`,
    ganglie: (from: string, skill: string) => `${skill} from ${from}: discard 2 hand cards, or lose 1 HP.`,
    guanshi: (target: string) => `Your Strike was dodged. Discard 2 cards to hit ${target} anyway?`,
    guicai: (target: string, card: string) =>
      `A judgement for ${target} flipped ${card}. Play a hand card in its place?`,
    guanxing: 'Pick the cards to put under the pile. The rest stay on top in the order shown.',
    qilin: (target: string) => `Your Strike hit ${target}. Discard one of the horses they wear?`,
    qinglong: (target: string) => `Your Strike was dodged. Play another Strike at ${target}?`,
    chai: (owner: string) => `Pick a card of ${owner}’s to discard.`,
    shun: (owner: string) => `Pick a card of ${owner}’s to take.`,
    fankui: (owner: string) => `Pick a card of ${owner}’s to take.`,
    tuxi: 'Pick up to 2 players to take a hand card from, or none to draw as usual.',
    confirm: enConfirm,
  },
  log: {
    start: (n: number) => `${String(n).startsWith('8') ? 'An' : 'A'} ${n}-player game begins. The lord plays first.`,
    hero: (who: string, hero: string, kingdom: string) => `${who} chose ${hero} (${kingdom}).`,
    turn: (n: number, who: string) => `Turn ${n}: ${who}`,
    use: (who: string, card: string, skill: string | null, targets: string | null) =>
      `${who}${skill !== null ? ` (${skill})` : ''} played ${card}${targets !== null ? ` on ${targets}` : ''}.`,
    answer: (who: string, card: string, skill: string | null) =>
      `${who}${skill !== null ? ` (${skill})` : ''} played ${card}.`,
    save: (who: string, card: string, skill: string | null, victim: string) =>
      `${who}${skill !== null ? ` (${skill})` : ''} played ${card} to save ${victim}.`,
    turned: (card: string, as: string) => `${card} as ${as}`,
    skill: (who: string, skill: string, targets: string | null) =>
      `${who} used ${skill}${targets !== null ? ` on ${targets}` : ''}.`,
    damage: (who: string, n: number, source: string | null) =>
      `${who} took ${n} damage${source !== null ? ` from ${source}` : ''}.`,
    lose: (who: string, n: number) => `${who} lost ${n} HP.`,
    heal: (who: string, n: number) => `${who} healed ${n} HP.`,
    draw: (who: string, n: number) => `${who} drew ${n} card${n === 1 ? '' : 's'}.`,
    drawn: (who: string, cards: string) => `${who} drew ${cards}.`,
    discard: (who: string, cards: string, owner: string | null) =>
      `${who} discarded ${cards}${owner !== null ? ` from ${owner}` : ''}.`,
    takeFrom: (who: string, cards: string, owner: string) => `${who} took ${cards} from ${owner}.`,
    takeHidden: (who: string, n: number, owner: string) =>
      `${who} took ${n === 1 ? 'a hand card' : `${n} hand cards`} from ${owner}.`,
    take: (who: string, cards: string) => `${who} took ${cards}.`,
    give: (who: string, n: number, to: string) => `${who} gave ${n} card${n === 1 ? '' : 's'} to ${to}.`,
    giveCards: (who: string, cards: string, to: string) => `${who} gave ${cards} to ${to}.`,
    equip: (who: string, card: string) => `${who} equipped ${card}.`,
    judge: (who: string, why: string, card: string) => `Judgement for ${who} (${why}): ${card}.`,
    armorUsed: (who: string, armor: string) => `${who} used ${armor}.`,
    armorBlocked: (who: string, armor: string) => `${armor} shielded ${who} from the Strike.`,
    cancel: (card: string, target: string | null) =>
      `${card} was cancelled${target !== null ? ` for ${target}` : ''}.`,
    skip: (who: string, phase: string) => `${who} skipped the ${phase} phase.`,
    die: (who: string, role: string, killer: string | null) =>
      `${who} fell (${role})${killer !== null ? `, killed by ${killer}` : ''}.`,
    shuffle: 'The discards were shuffled back into the pile.',
  },
  win: 'You win!',
  lose: 'You lose.',
  winLord: 'The lord’s side wins: every rebel and the traitor are out.',
  winRebel: 'The rebels win: the lord has fallen.',
  winTraitor: 'The traitor wins: the last one standing.',
  calledOff: 'The game was called off after too many turns. Nobody wins.',
  reveal: (list: string) => `Roles: ${list}`,
  chat: {
    hit: ['Take that!', 'Nothing personal.', 'Got you.'],
    hurt: ['Ouch!', 'That hurt…', 'Hey! Who did that?'],
    heal: ['Thanks, I needed that.', 'Much better.', 'Phew.'],
    kill: ['One down.', 'Sorry, it had to be done.', 'Next!'],
    fall: ['I’ll be back…', 'Good game…', 'Oh no.'],
    win: ['We did it!', 'A win is a win.', 'GG!'],
    lose: ['Next time!', 'That was close.', 'Well played.'],
  },
};

export type SanguoshaWords = typeof enSanguosha;

const zhCard: Record<CardName, Named> = {
  sha: { name: '杀', tip: '出牌阶段对攻击范围内的一名角色使用：目标须打出一张【闪】，否则失去 1 点体力。每回合限一张。' },
  shan: { name: '闪', tip: '成为【杀】或【万箭齐发】的目标时打出，抵消其伤害。' },
  tao: { name: '桃', tip: '出牌阶段可以回复 1 点体力；回合外可以打出来救援濒死的角色。' },
  juedou: { name: '决斗', tip: '指定一名角色：你与对方轮流打出【杀】，由对方先出，先出不了的人失去 1 点体力。' },
  chai: { name: '过河拆桥', tip: '指定一名角色，弃置其一张牌：手牌（盲选）、装备或判定区的牌。' },
  shun: { name: '顺手牵羊', tip: '获得距离为 1 的一名角色的一张牌：手牌（盲选）、装备或判定区的牌。' },
  wuzhong: { name: '无中生有', tip: '摸两张牌。' },
  nanman: { name: '南蛮入侵', tip: '其他角色须各打出一张【杀】，否则失去 1 点体力。' },
  wanjian: { name: '万箭齐发', tip: '其他角色须各打出一张【闪】，否则失去 1 点体力。' },
  taoyuan: { name: '桃园结义', tip: '所有受伤的角色各回复 1 点体力。' },
  wuxie: { name: '无懈可击', tip: '一张锦囊牌对某个角色生效时打出，使其对该角色无效。【无懈可击】也可以被抵消。' },
  lebu: { name: '乐不思蜀', tip: '放到其他角色的判定区。其判定阶段进行判定：不是红桃就跳过出牌阶段。' },
  bing: { name: '兵粮寸断', tip: '放到距离为 1 的角色的判定区。其判定阶段进行判定：不是梅花就跳过摸牌阶段。' },
  shandian: { name: '闪电', tip: '放到自己的判定区。每次判定：2 至 9 的黑桃对持有者造成 3 点伤害；否则传给下一名角色。' },
  zhuge: { name: '诸葛连弩', tip: '武器，攻击范围 1。出牌阶段使用【杀】没有次数限制。' },
  qinggang: { name: '青釭剑', tip: '武器，攻击范围 2。你的【杀】无视目标的防具。' },
  qinglong: { name: '青龙偃月刀', tip: '武器，攻击范围 3。你的【杀】被【闪】抵消时，可以对同一目标再打出一张【杀】。' },
  guanshi: { name: '贯石斧', tip: '武器，攻击范围 3。你的【杀】被【闪】抵消时，可以弃置两张牌使其依然命中。' },
  fangtian: { name: '方天画戟', tip: '武器，攻击范围 4。你的手牌只剩这张【杀】时，可以指定至多三名目标。' },
  qilin: { name: '麒麟弓', tip: '武器，攻击范围 5。你的【杀】命中后，可以弃置目标的一匹马。' },
  bagua: { name: '八卦阵', tip: '防具。需要打出【闪】时，可以判定：红色视为打出了【闪】。' },
  renwang: { name: '仁王盾', tip: '防具。黑色的【杀】对你无效。' },
  dilu: { name: '的卢', tip: '+1 马：其他角色到你需要多走一步。' },
  jueying: { name: '绝影', tip: '+1 马：其他角色到你需要多走一步。' },
  zhuahuang: { name: '爪黄飞电', tip: '+1 马：其他角色到你需要多走一步。' },
  chitu: { name: '赤兔', tip: '−1 马：你到其他角色少走一步。' },
  dawan: { name: '大宛', tip: '−1 马：你到其他角色少走一步。' },
  zixing: { name: '紫骍', tip: '−1 马：你到其他角色少走一步。' },
};

const zhHero: Record<HeroId, string> = {
  liubei: '刘备', guanyu: '关羽', zhangfei: '张飞', zhugeliang: '诸葛亮', zhaoyun: '赵云', machao: '马超',
  huangyueying: '黄月英', caocao: '曹操', simayi: '司马懿', xiahoudun: '夏侯惇', zhangliao: '张辽', xuchu: '许褚',
  guojia: '郭嘉', zhenji: '甄姬', sunquan: '孙权', lvmeng: '吕蒙', huanggai: '黄盖', zhouyu: '周瑜', ganning: '甘宁',
  daqiao: '大乔', luxun: '陆逊', sunshangxiang: '孙尚香', huatuo: '华佗', lvbu: '吕布', diaochan: '貂蝉',
};

const zhSkill: Record<SkillId, Named> = {
  rende: { name: '仁德', tip: '出牌阶段，可以把任意张手牌交给其他角色。每回合你交出的牌第一次累计达到两张时，回复 1 点体力。' },
  wusheng: { name: '武圣', tip: '你可以把任意一张红色牌当【杀】打出。' },
  paoxiao: { name: '咆哮', tip: '你使用【杀】没有次数限制。' },
  guanxing: { name: '观星', tip: '回合开始时，观看牌堆顶的若干张牌（等于存活角色数，最多 5 张），可以把其中任意张放到牌堆底。' },
  kongcheng: { name: '空城', tip: '没有手牌时，你不能成为【杀】或【决斗】的目标。' },
  longdan: { name: '龙胆', tip: '你可以把【杀】当【闪】、把【闪】当【杀】使用或打出。' },
  mashu: { name: '马术', tip: '你到其他角色都少走一步。' },
  tieqi: { name: '铁骑', tip: '你使用【杀】时进行判定：若为红色，目标不能使用【闪】。' },
  jizhi: { name: '集智', tip: '每当你使用一张即时生效的锦囊牌，摸一张牌。' },
  qicai: { name: '奇才', tip: '你使用锦囊牌没有距离限制。' },
  jianxiong: { name: '奸雄', tip: '受到伤害后，获得造成伤害的牌。' },
  fankui: { name: '反馈', tip: '受到玩家造成的伤害后，获得其一张牌。' },
  guicai: { name: '鬼才', tip: '一张判定牌生效前，你可以打出一张手牌代替它。' },
  ganglie: { name: '刚烈', tip: '受到玩家造成的伤害后，进行判定：若不是红桃，伤害来源须弃置两张手牌，否则失去 1 点体力。' },
  tuxi: { name: '突袭', tip: '摸牌阶段，可以放弃摸牌，改为从至多两名角色的手牌中各随机获得一张。' },
  luoyi: { name: '裸衣', tip: '摸牌阶段，可以少摸一张牌：直到回合结束，你的【杀】和【决斗】造成的伤害 +1。' },
  tiandu: { name: '天妒', tip: '你的判定牌生效后，你获得它。' },
  yiji: { name: '遗计', tip: '受到伤害后，摸两张牌。' },
  luoshen: { name: '洛神', tip: '回合开始时，可以连续判定：每翻出一张黑色牌就获得它并可继续；翻出红色牌则弃置它并结束。' },
  qingguo: { name: '倾国', tip: '你可以把任意一张黑色手牌当【闪】使用或打出。' },
  zhiheng: { name: '制衡', tip: '出牌阶段限一次，弃置任意张牌（含装备），然后摸等量的牌。' },
  keji: { name: '克己', tip: '若你在回合内没有使用或打出【杀】，则跳过弃牌阶段。' },
  kurou: { name: '苦肉', tip: '出牌阶段，体力大于 1 时可以失去 1 点体力，摸两张牌。' },
  yingzi: { name: '英姿', tip: '摸牌阶段，你多摸一张牌。' },
  qixi: { name: '奇袭', tip: '你可以把任意一张黑色牌当【过河拆桥】使用。' },
  guose: { name: '国色', tip: '你可以把任意一张方块牌当【乐不思蜀】使用。' },
  qianxun: { name: '谦逊', tip: '你不能成为【顺手牵羊】和【乐不思蜀】的目标。' },
  lianying: { name: '连营', tip: '当你失去最后一张手牌时，摸一张牌。' },
  xiaoji: { name: '枭姬', tip: '每当你失去一张装备牌，摸两张牌。' },
  qingnang: { name: '青囊', tip: '出牌阶段限一次，弃置一张手牌，令一名受伤的角色回复 1 点体力。' },
  jijiu: { name: '急救', tip: '回合外，你可以把任意一张红色牌当【桃】使用。' },
  wushuang: { name: '无双', tip: '你的【杀】需要两张【闪】才能抵消；与你【决斗】的角色每次需要打出两张【杀】。' },
  biyue: { name: '闭月', tip: '结束阶段，摸一张牌。' },
};

const zhConfirm: Record<ConfirmWhy, string> = {
  bagua: `${zhCard.bagua.name}：判定一张牌，红色视为你打出了【闪】。要使用吗？`,
  luoshen: `${zhSkill.luoshen.name}：翻一张牌吗？黑色牌归你，翻到红色牌则弃置并结束。`,
  luoyi: `${zhSkill.luoyi.name}：少摸一张牌，本回合你的【杀】和【决斗】伤害 +1？`,
};

export const zhSanguosha: SanguoshaWords = {
  title: '三国杀',
  rules: '5 人或 8 人的身份局：1 名主公，若干忠臣和反贼，1 名内奸（5 人：1 忠 2 反 1 内；8 人：2 忠 4 反 1 内）。只有主公的身份公开。每人先选武将（主公先选），起手摸 4 张牌。每个回合：摸 2 张牌、出牌，最后弃牌到不超过体力。击杀反贼摸 3 张牌；主公杀死忠臣则弃光所有牌。牌组、武将和规则文字都是自制的精简版，没有官方美术，是非官方的同人版本；“三国杀”是游卡桌游那款游戏的名字。',
  size5: '5 人场',
  size8: '8 人场',
  pick: '最多选 {n} 只桌宠陪你玩，空位会自动补上。',
  bots: '桌宠按自己的规则出牌：不使用 Copilot CLI，也不消耗额度。',
  card: zhCard,
  hero: zhHero,
  skill: zhSkill,
  kingdom: { shu: '蜀', wei: '魏', wu: '吴', qun: '群' },
  role: { lord: '主公', loyalist: '忠臣', rebel: '反贼', traitor: '内奸' },
  roleHint: {
    lord: '你多 1 点体力，并且先出牌。击败所有反贼和内奸即获胜；你阵亡则反贼获胜。',
    loyalist: '保护主公。反贼和内奸全部出局时，你与主公一同获胜。',
    rebel: '击败主公。主公阵亡时你获胜，除非场上只剩内奸一人。',
    traitor: '你要独自获胜：主公阵亡时，场上只剩你一人。若主公阵亡时还有别的角色存活，反贼获胜。',
  },
  phase: { start: '准备', judge: '判定', draw: '摸牌', play: '出牌', discard: '弃牌', end: '结束' },
  join: (items) => items.join('、'),
  cardRef: (name) => `【${name}】`,
  cardTag: (name, tag) => `【${name}】${tag}`,
  youAre: (role) => `你的身份是${role}。`,
  turnNo: '第 {n} 回合',
  pile: '牌堆 {n}',
  hand: '手牌 {n}',
  dist: '距离 {n}',
  range: '攻击范围 {n}',
  out: '阵亡',
  spectating: '你已阵亡，可以继续观战。',
  waiting: '等待其他人……',
  yourTurn: '你的回合',
  endTurn: '结束回合',
  ok: '确定',
  cancel: '取消',
  pass: '放弃',
  yes: '是',
  no: '否',
  pickTarget: '选择一个目标。',
  pickTargets: '最多选 {n} 个目标，然后点确定。',
  pickCards: '选好牌后点确定。',
  playAs: '把 {card} 当作：',
  yourSkills: '你的技能',
  hiddenCard: '一张手牌',
  ask: {
    hero: '选择你的武将。',
    heroLord: '你是主公，请选择武将。主公多 1 点体力。',
    play: '轮到你了。点一张牌打出，或者发动技能。',
    dodge: (from, card, need) => `${from} 的${card}。打出一张【闪】${need > 1 ? `（还需 ${need} 张）` : ''}，否则受到伤害。`,
    strike: (from, card, need) => `${from} 的${card}。打出一张【杀】${need > 1 ? `（还需 ${need} 张）` : ''}，否则失去 1 点体力。`,
    peach: (victim, self) => (self ? '你濒死了！打出一张【桃】自救？' : `${victim} 濒死了。要打出【桃】救他吗？`),
    counter: (card, from, target, on) => {
      const what = from !== null && target !== null
        ? `${from} 的${card}即将对${target}生效。`
        : from !== null
          ? `${from} 的${card}即将生效。`
          : target !== null ? `${card}即将对${target}生效。` : `${card}即将生效。`;
      return `${what}${on ? '要打出【无懈可击】使其无效吗？' : '它暂时被抵消了。要再打出【无懈可击】让它生效吗？'}`;
    },
    discard: (n) => `请弃置 ${n} 张牌。`,
    ganglie: (from, skill) => `${from} 的${skill}：弃置两张手牌，否则失去 1 点体力。`,
    guanshi: (target) => `你的【杀】被闪避了。弃置两张牌，让它依然命中${target}？`,
    guicai: (target, card) => `${target}的判定翻出了${card}。要打出一张手牌代替它吗？`,
    guanxing: '选出要放到牌堆底的牌，其余的按所示顺序留在牌堆顶。',
    qilin: (target) => `你的【杀】命中了${target}。要弃置他的一匹马吗？`,
    qinglong: (target) => `你的【杀】被闪避了。要对${target}再打出一张【杀】吗？`,
    chai: (owner) => `选择 ${owner} 的一张牌弃置。`,
    shun: (owner) => `选择 ${owner} 的一张牌获得。`,
    fankui: (owner) => `选择 ${owner} 的一张牌获得。`,
    tuxi: '最多选两名角色，各拿走一张手牌；不选则正常摸牌。',
    confirm: zhConfirm,
  },
  log: {
    start: (n) => `${n} 人局开始，主公先出牌。`,
    hero: (who, hero, kingdom) => `${who}选择了${hero}（${kingdom}）。`,
    turn: (n, who) => `第 ${n} 回合：${who}`,
    use: (who, card, skill, targets) =>
      `${who}${skill !== null ? `（${skill}）` : ''}使用了${card}${targets !== null ? `，目标：${targets}` : ''}。`,
    answer: (who, card, skill) => `${who}${skill !== null ? `（${skill}）` : ''}打出了${card}。`,
    save: (who, card, skill, victim) => `${who}${skill !== null ? `（${skill}）` : ''}打出${card}，救了${victim}。`,
    turned: (card, as) => `${card}当作${as}`,
    skill: (who, skill, targets) => `${who}发动了${skill}${targets !== null ? `，目标：${targets}` : ''}。`,
    damage: (who, n, source) => `${who}受到${source !== null ? ` ${source} 造成的` : ''} ${n} 点伤害。`,
    lose: (who, n) => `${who}失去了 ${n} 点体力。`,
    heal: (who, n) => `${who}回复了 ${n} 点体力。`,
    draw: (who, n) => `${who}摸了 ${n} 张牌。`,
    drawn: (who, cards) => `${who}摸到了${cards}。`,
    discard: (who, cards, owner) => (owner !== null ? `${who}弃置了${owner}的${cards}。` : `${who}弃置了${cards}。`),
    takeFrom: (who, cards, owner) => `${who}获得了${owner}的${cards}。`,
    takeHidden: (who, n, owner) => `${who}获得了${owner}的 ${n} 张手牌。`,
    take: (who, cards) => `${who}获得了${cards}。`,
    give: (who, n, to) => `${who}交给${to} ${n} 张牌。`,
    giveCards: (who, cards, to) => `${who}把${cards}交给了${to}。`,
    equip: (who, card) => `${who}装备了${card}。`,
    judge: (who, why, card) => `${who}的判定（${why}）：${card}。`,
    armorUsed: (who, armor) => `${who}发动了${armor}。`,
    armorBlocked: (who, armor) => `${armor}挡住了对${who}的【杀】。`,
    cancel: (card, target) => `${card}${target !== null ? `对${target}` : ''}被抵消了。`,
    skip: (who, phase) => `${who}跳过了${phase}阶段。`,
    die: (who, role, killer) => `${who}阵亡了（${role}）${killer !== null ? `，被${killer}击杀` : ''}。`,
    shuffle: '弃牌堆洗回了牌堆。',
  },
  win: '你赢了！',
  lose: '你输了。',
  winLord: '主公方获胜：所有反贼和内奸都已出局。',
  winRebel: '反贼获胜：主公阵亡了。',
  winTraitor: '内奸获胜：他是最后的幸存者。',
  calledOff: '回合数太多，对局被终止，无人获胜。',
  reveal: (list) => `身份：${list}`,
  chat: {
    hit: ['接招！', '没有针对你。', '中了！'],
    hurt: ['哎哟！', '好疼……', '喂！谁打的？'],
    heal: ['谢谢，正需要这个。', '好多了。', '呼，得救了。'],
    kill: ['倒下一个。', '抱歉，必须这么做。', '下一个！'],
    fall: ['我还会回来的……', '打得不错……', '啊，不……'],
    win: ['我们赢了！', '赢了就好。', '漂亮！'],
    lose: ['下次再来！', '差一点点。', '打得好。'],
  },
};
