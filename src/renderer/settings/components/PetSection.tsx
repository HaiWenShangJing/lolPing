import { Dropdown, Option } from '@fluentui/react-components';
import { Emoji24Regular } from '@fluentui/react-icons';
import { Fragment, useEffect, useState } from 'react';
import { PET_IDS, PET_RESTS, type PetId, type PetSetting } from '../../../shared/teammate/pet';
import { HOST_ACTIVITIES, ROAM_KINDS, hostModel, type HostModel } from '../../../shared/teammate/petHost';
import { ROAM_CHOICES } from '../../../shared/teammate/petRoam';
import { api } from '../api';
import { useText } from '../text';
import type { Update } from '../useAppState';
import { SettingRow, SwitchRow } from './rows';
import type { Settings } from '../../../shared/settings';

const modelLabel = (m: HostModel): string => (m.cost ? `${m.name} · ${m.cost}` : m.name);

/** The desktop pets: each character on or off, and the animation it rests in. */
export function PetSection({ settings: s, update }: { settings: Settings; update: Update }) {
  const t = useText();
  const m = t.teammate.settings;
  const mate = s.teammate;
  const names: Record<PetId, string> = {
    whale: m.petWhale, naiwa: m.petNaiwa, shenshen: m.petShenshen, airi: m.petAiri, hiyori: m.petHiyori,
  };
  const hosting = mate.petRoam && mate.petRoamKind === 'host';
  const [models, setModels] = useState<HostModel[]>([]);
  useEffect(() => {
    if (!hosting) return;
    let current = true;
    api.listHostModels().then((list) => {
      if (current) setModels(list);
    }).catch(() => undefined);
    return () => {
      current = false;
    };
  }, [hosting]);
  const chosen = models.find((x) => x.id === mate.petHostModel);
  const chosenLabel = mate.petHostModel === null ? m.petHostModelDefault : chosen ? modelLabel(chosen) : mate.petHostModel;

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
          <SettingRow icon={null} title={m.petHostModel} description={m.petHostModelDesc} dim={!mate.petRoam}>
            <Dropdown style={{ minWidth: 230 }} value={chosenLabel} selectedOptions={[mate.petHostModel ?? '']}
              disabled={!mate.petRoam} listbox={{ style: { maxHeight: 260 } }}
              positioning={{ position: 'above', align: 'end', autoSize: 'height', fallbackPositions: ['below-end'] }}
              onOptionSelect={(_, d) => {
                const petHostModel = d.optionValue === '' ? null : hostModel(d.optionValue);
                if (d.optionValue === '' || petHostModel !== null) void update({ teammate: { ...mate, petHostModel } });
              }}>
              <Option value="" text={m.petHostModelDefault}>{m.petHostModelDefault}</Option>
              {models.map((x) => <Option key={x.id} value={x.id} text={modelLabel(x)}>{modelLabel(x)}</Option>)}
            </Dropdown>
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
        </>
      )}
      {PET_IDS.map((id) => {
        const pet = mate.pets[id];
        const setPet = (p: Partial<PetSetting>) =>
          void update({ teammate: { ...mate, pets: { ...mate.pets, [id]: { ...pet, ...p } } } });
        return (
          <Fragment key={id}>
            <SwitchRow icon={<Emoji24Regular />} title={names[id]} description={id === 'hiyori' ? m.petHiyoriDesc : undefined}
              checked={pet.on} onChange={(on) => setPet({ on })} />
            <SettingRow icon={null} title={m.petRest} description={m.petRestDesc} dim={!pet.on}>
              <Dropdown style={{ minWidth: 150 }} value={m.petAnims[pet.rest] ?? pet.rest} selectedOptions={[pet.rest]}
                disabled={!pet.on} listbox={{ style: { maxHeight: 240 } }}
                positioning={{ position: 'above', align: 'end', autoSize: 'height', fallbackPositions: ['below-end'] }}
                onOptionSelect={(_, d) => {
                  const rest = PET_RESTS[id].find((r) => r === d.optionValue);
                  if (rest) setPet({ rest });
                }}>
                {PET_RESTS[id].map((r) => <Option key={r} value={r} text={m.petAnims[r] ?? r}>{m.petAnims[r] ?? r}</Option>)}
              </Dropdown>
            </SettingRow>
          </Fragment>
        );
      })}
    </>
  );
}
