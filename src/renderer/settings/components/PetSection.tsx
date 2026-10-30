import { Button, Combobox, Dropdown, Option, Textarea } from '@fluentui/react-components';
import { ArrowClockwise20Regular, Brain24Regular, Chat24Regular, Emoji24Regular, Games24Regular } from '@fluentui/react-icons';
import { Fragment, useEffect, useState } from 'react';
import { PET_IDS, PET_REST_CHOICES, isFanPet, isLive2dPet, type PetId, type PetSetting } from '../../../shared/teammate/pet';
import {
  HOST_ACTIVITIES, ROAM_KINDS, hostModel, type HostModel, type HostModelList,
} from '../../../shared/teammate/petHost';
import { DEFAULT_PERSONAS, type PetNote } from '../../../shared/teammate/petMind';
import { ROAM_CHOICES } from '../../../shared/teammate/petRoam';
import { PERSONA_MAX } from '../../../shared/teammate/petText';
import { api } from '../api';
import { useText } from '../text';
import type { Update } from '../useAppState';
import { ExpanderRow, SettingRow, SwitchRow } from './rows';
import type { Settings } from '../../../shared/settings';

const modelLabel = (m: HostModel): string => (m.cost ? `${m.name} · ${m.cost}` : m.name);
/** The list entry that stands for "no model of its own"; it can't be a model id. */
const NONE = '*';

/**
 * A model chosen from what Copilot CLI offers or typed as any id it accepts. `null` is no choice: the Copilot default,
 * or for a pet the model of all the others.
 */
function ModelPicker({ value, models, none, onCommit }: {
  value: string | null; models: readonly HostModel[]; none: string; onCommit(v: string | null): void;
}) {
  const m = useText().teammate.settings;
  const labelOf = (v: string | null): string => {
    const hit = v === null ? undefined : models.find((x) => x.id === v);
    return v === null ? none : hit ? modelLabel(hit) : v;
  };
  const [text, setText] = useState(labelOf(value));
  const [typing, setTyping] = useState(false);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (!typing) setText(labelOf(value));
  }, [value, models, none, typing]);

  // undefined: the text is neither an entry of the list nor a model id.
  const resolve = (raw: string): string | null | undefined => {
    const q = raw.trim();
    if (q === '' || q === none) return null;
    const hit = models.find((x) => x.id === q || modelLabel(x) === q || x.name.toLowerCase() === q.toLowerCase());
    return hit ? hit.id : hostModel(q) ?? undefined;
  };
  const commit = (raw: string) => {
    setTyping(false);
    const next = resolve(raw);
    setBad(next === undefined);
    if (next === undefined) {
      setText(labelOf(value));
      return;
    }
    setText(labelOf(next));
    if (next !== value) onCommit(next);
  };

  return (
    <div className="mateStack">
      <Combobox freeform value={text} placeholder={m.petModelPlaceholder} style={{ width: 290 }}
        listbox={{ style: { maxHeight: 260 } }} selectedOptions={[value ?? NONE]}
        positioning={{ position: 'below', align: 'end', autoSize: 'height', fallbackPositions: ['above-end'] }}
        onChange={(e) => {
          setTyping(true);
          setText(e.target.value);
        }}
        onBlur={() => typing && commit(text)}
        onKeyDown={(e) => e.key === 'Enter' && typing && commit(text)}
        onOptionSelect={(e, d) => {
          // Enter after typing also selects the option the list has highlighted: the typed text is what was meant.
          if (d.optionValue === undefined || (typing && e.type === 'keydown')) return;
          commit(d.optionValue === NONE ? '' : d.optionValue);
        }}>
        <Option value={NONE} text={none}>{none}</Option>
        {models.map((x) => <Option key={x.id} value={x.id} text={modelLabel(x)}>{modelLabel(x)}</Option>)}
      </Combobox>
      {bad ? <span className="weImportError">{m.petModelInvalid}</span> : null}
    </div>
  );
}

/** What a pet is like, in the user's words; the default is shown where it's left empty. */
function PersonaBox({ id, value, onSave }: { id: PetId; value: string; onSave(v: string): void }) {
  const m = useText().teammate.settings;
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="expPane">
      <span className="paneTitle">{m.petPersona}</span>
      <span className="desc">{m.petPersonaDesc}</span>
      <Textarea className="mateInstructions" value={draft} maxLength={PERSONA_MAX} resize="vertical"
        placeholder={DEFAULT_PERSONAS[id]} aria-label={m.petPersona} onChange={(_, d) => setDraft(d.value)}
        onBlur={() => draft.trim() !== value && onSave(draft.trim())} />
    </div>
  );
}

/** What a pet chose to remember; the user can have it forget one note or all of them. */
function PetMemory({ id, names }: { id: PetId; names: Record<PetId, string> }) {
  const m = useText().teammate.settings;
  const [notes, setNotes] = useState<PetNote[]>([]);
  useEffect(() => {
    let current = true;
    const read = () => void api.getPetNotes(id).then((n) => current && setNotes(n)).catch(() => undefined);
    read();
    // The pet adds notes while the window is open: read them again when it regains focus.
    window.addEventListener('focus', read);
    return () => {
      current = false;
      window.removeEventListener('focus', read);
    };
  }, [id]);
  const forget = (number: number | null) => void api.forgetPetNote(id, number).then(setNotes).catch(() => undefined);
  const about = (n: PetNote): string | null =>
    n.about === null ? null : n.about === 'user' ? m.petMemoryAboutYou : m.petMemoryAbout(names[n.about]);
  return (
    <div className="expPane">
      <span className="paneTitle">{m.petMemory}</span>
      <span className="desc">{m.petMemoryDesc}</span>
      {notes.length === 0 ? <span className="desc petNotesNone">{m.petMemoryNone}</span> : (
        <div className="petNotes">
          {notes.map((n, i) => (
            <div className="petNote" key={`${n.at}-${i}`}>
              <span className="txt">{n.text}</span>
              {about(n) ? <span className="tag">{about(n)}</span> : null}
              <Button appearance="subtle" size="small" onClick={() => forget(i + 1)}>{m.petMemoryForget}</Button>
            </div>
          ))}
        </div>
      )}
      {notes.length > 1 ? (
        <div className="mateRow mateNote">
          <Button appearance="subtle" onClick={() => forget(null)}>{m.petMemoryForgetAll}</Button>
        </div>
      ) : null}
    </div>
  );
}

/** The desktop pets: each character on or off, and the animation it rests in. */
export function PetSection({ settings: s, update }: { settings: Settings; update: Update }) {
  const t = useText();
  const m = t.teammate.settings;
  const who = t.teammate.ask.petName;
  const mate = s.teammate;
  const names: Record<PetId, string> = {
    whale: m.petWhale, naiwa: m.petNaiwa, shenshen: m.petShenshen, airi: m.petAiri,
    hiyori: m.petLive2d(who.hiyori), haru: m.petLive2d(who.haru), mao: m.petLive2d(who.mao),
    rice: m.petLive2d(who.rice), senko: m.petLive2d(who.senko), mark: m.petLive2d(who.mark),
    laffey: m.petLive2d(who.laffey), unicorn: m.petLive2d(who.unicorn), javelin: m.petLive2d(who.javelin),
    shoukaku: m.petLive2d(who.shoukaku), doubao: m.petDoubao,
  };
  const describe = (id: PetId): string | undefined => {
    if (id === 'doubao') return m.petDoubaoDesc;
    if (isFanPet(id)) return m.petFanDesc;
    return isLive2dPet(id) ? m.petLive2dDesc : undefined;
  };
  const hosting = mate.petRoam && mate.petRoamKind === 'host';

  // What was said last time appears at once and the live answer replaces it: asking Copilot CLI takes a process start.
  const [list, setList] = useState<HostModelList>({ models: [], source: 'cache', error: null });
  const [asking, setAsking] = useState(false);
  const ask = (force: boolean, isCurrent: () => boolean = () => true) => {
    setAsking(true);
    void api.listHostModels(true, force).then((l) => isCurrent() && setList(l)).catch(() => undefined)
      .finally(() => isCurrent() && setAsking(false));
  };
  useEffect(() => {
    let current = true;
    void api.listHostModels(false).then((l) => current && setList(l)).catch(() => undefined);
    ask(false, () => current);
    return () => {
      current = false;
    };
  }, []);
  const status = asking ? m.petModelsLoading
    : list.error !== null ? m.petModelsError(list.error)
    : list.source === 'live' ? m.petModelsLive(list.models.length) : null;
  const setModel = (petHostModel: string | null) => void update({ teammate: { ...mate, petHostModel } });

  return (
    <>
      <p className="desc roomNote">{m.petDesc}</p>
      <SwitchRow icon={<Emoji24Regular />} title={m.petLife} description={m.petLifeDesc} checked={mate.petLife}
        onChange={(petLife) => void update({ teammate: { ...mate, petLife } })} />
      <SwitchRow icon={<Emoji24Regular />} title={m.petAgents} description={m.petAgentsDesc} checked={mate.agentsCanDrivePets}
        onChange={(agentsCanDrivePets) => void update({ teammate: { ...mate, agentsCanDrivePets } })} />
      <SwitchRow icon={<Emoji24Regular />} title={m.petRoam} description={m.petRoamDesc} checked={mate.petRoam}
        onChange={(petRoam) => void update({ teammate: { ...mate, petRoam } })} />
      <SettingRow icon={null} title={m.petRoamKind} description={m.petRoamKindDesc} dim={!mate.petRoam}>
        <Dropdown style={{ minWidth: 190 }} value={m.petRoamKindOption[mate.petRoamKind]}
          selectedOptions={[mate.petRoamKind]} disabled={!mate.petRoam}
          positioning={{ position: 'above', align: 'end', autoSize: 'height', fallbackPositions: ['below-end'] }}
          onOptionSelect={(_, d) => {
            const petRoamKind = ROAM_KINDS.find((k) => k === d.optionValue);
            if (petRoamKind) void update({ teammate: { ...mate, petRoamKind } });
          }}>
          {ROAM_KINDS.map((k) => (
            <Option key={k} value={k} text={m.petRoamKindOption[k]}>{m.petRoamKindOption[k]}</Option>
          ))}
        </Dropdown>
      </SettingRow>
      {mate.petRoamKind === 'visit' ? (
        <SettingRow icon={null} title={m.petRoamEvery} description={m.petRoamEveryDesc} dim={!mate.petRoam}>
          <Dropdown style={{ minWidth: 150 }} value={m.petRoamEveryOption(mate.petRoamMin)}
            selectedOptions={[String(mate.petRoamMin)]} disabled={!mate.petRoam}
            positioning={{ position: 'above', align: 'end', autoSize: 'height', fallbackPositions: ['below-end'] }}
            onOptionSelect={(_, d) => {
              const petRoamMin = ROAM_CHOICES.find((c) => String(c) === d.optionValue);
              if (petRoamMin) void update({ teammate: { ...mate, petRoamMin } });
            }}>
            {ROAM_CHOICES.map((c) => (
              <Option key={c} value={String(c)} text={m.petRoamEveryOption(c)}>{m.petRoamEveryOption(c)}</Option>
            ))}
          </Dropdown>
        </SettingRow>
      ) : (
        <>
          <SettingRow icon={null} title={m.petHostModel} dim={!mate.petRoam}
            description={<>{m.petHostModelDesc}{status ? <span className="desc">{status}</span> : null}</>}>
            <ModelPicker value={mate.petHostModel} models={list.models} none={m.petHostModelDefault} onCommit={setModel} />
            <Button appearance="subtle" icon={<ArrowClockwise20Regular />} disabled={asking} aria-label={m.petModelRefresh}
              title={m.petModelRefresh} onClick={() => ask(true)} />
          </SettingRow>
          <SettingRow icon={null} title={m.petHostActivity} description={m.petHostActivityDesc} dim={!mate.petRoam}>
            <Dropdown style={{ minWidth: 200 }} value={m.petHostActivityOption[mate.petHostActivity]}
              selectedOptions={[mate.petHostActivity]} disabled={!mate.petRoam}
              positioning={{ position: 'above', align: 'end', autoSize: 'height', fallbackPositions: ['below-end'] }}
              onOptionSelect={(_, d) => {
                const petHostActivity = HOST_ACTIVITIES.find((a) => a === d.optionValue);
                if (petHostActivity) void update({ teammate: { ...mate, petHostActivity } });
              }}>
              {HOST_ACTIVITIES.map((a) => (
                <Option key={a} value={a} text={m.petHostActivityOption[a]}>{m.petHostActivityOption[a]}</Option>
              ))}
            </Dropdown>
          </SettingRow>
          <SwitchRow icon={<Chat24Regular />} title={m.petSocial} description={m.petSocialDesc} checked={mate.petSocial}
            dim={!mate.petRoam} disabled={!mate.petRoam}
            onChange={(petSocial) => void update({ teammate: { ...mate, petSocial } })} />
          <SettingRow icon={<Chat24Regular />} title={m.petLounge} description={m.petLoungeDesc} dim={!mate.petRoam}>
            <Button disabled={!mate.petRoam} onClick={() => void api.openPetLounge()}>{m.petLoungeOpen}</Button>
          </SettingRow>
        </>
      )}
      <SettingRow icon={<Games24Regular />} title={m.petGameWerewolf} description={m.petGameWerewolfDesc}>
        <Button onClick={() => void api.openPetGame('werewolf')}>{m.petGameOpen}</Button>
      </SettingRow>
      <SettingRow icon={<Games24Regular />} title={m.petGameMahjong} description={m.petGameMahjongDesc}>
        <Button onClick={() => void api.openPetGame('mahjong')}>{m.petGameOpen}</Button>
      </SettingRow>
      <SettingRow icon={<Games24Regular />} title={m.petGameFight} description={m.petGameFightDesc}>
        <Button onClick={() => void api.openPetGame('fight')}>{m.petGameStart}</Button>
      </SettingRow>
      {PET_IDS.map((id) => {
        const pet = mate.pets[id];
        const setPet = (p: Partial<PetSetting>) =>
          void update({ teammate: { ...mate, pets: { ...mate.pets, [id]: { ...pet, ...p } } } });
        const own = pet.model === null ? null : list.models.find((x) => x.id === pet.model);
        return (
          <Fragment key={id}>
            <SwitchRow icon={<Emoji24Regular />} title={names[id]} description={describe(id)}
              checked={pet.on} onChange={(on) => setPet({ on })} />
            <SettingRow icon={null} title={m.petRest} description={m.petRestDesc} dim={!pet.on}>
              <Dropdown style={{ minWidth: 150 }} value={m.petAnims[pet.rest] ?? pet.rest} selectedOptions={[pet.rest]}
                disabled={!pet.on} listbox={{ style: { maxHeight: 240 } }}
                positioning={{ position: 'above', align: 'end', autoSize: 'height', fallbackPositions: ['below-end'] }}
                onOptionSelect={(_, d) => {
                  const rest = PET_REST_CHOICES[id].find((r) => r === d.optionValue);
                  if (rest) setPet({ rest });
                }}>
                {PET_REST_CHOICES[id].map((r) => <Option key={r} value={r} text={m.petAnims[r] ?? r}>{m.petAnims[r] ?? r}</Option>)}
              </Dropdown>
            </SettingRow>
            {pet.on && hosting ? (
              <ExpanderRow icon={<Brain24Regular />} title={m.petMind(names[id])}
                description={pet.model === null ? m.petModelSame : own ? modelLabel(own) : pet.model}>
                <SettingRow icon={null} title={m.petHostModel} description={m.petModelOwnDesc}>
                  <ModelPicker value={pet.model} models={list.models} none={m.petModelSame}
                    onCommit={(model) => setPet({ model })} />
                </SettingRow>
                <PersonaBox id={id} value={pet.persona} onSave={(persona) => setPet({ persona })} />
                <PetMemory id={id} names={names} />
              </ExpanderRow>
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
}
