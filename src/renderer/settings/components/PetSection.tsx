import { Dropdown, Option } from '@fluentui/react-components';
import { Emoji24Regular } from '@fluentui/react-icons';
import { Fragment } from 'react';
import { PET_IDS, PET_RESTS, type PetId, type PetSetting } from '../../../shared/teammate/pet';
import { useText } from '../text';
import type { Update } from '../useAppState';
import { SettingRow, SwitchRow } from './rows';
import type { Settings } from '../../../shared/settings';

/** The desktop pets: each character on or off, and the animation it rests in. */
export function PetSection({ settings: s, update }: { settings: Settings; update: Update }) {
  const t = useText();
  const m = t.teammate.settings;
  const mate = s.teammate;
  const names: Record<PetId, string> = {
    whale: m.petWhale, naiwa: m.petNaiwa, shenshen: m.petShenshen, airi: m.petAiri, hiyori: m.petHiyori,
  };

  return (
    <>
      <p className="desc roomNote">{m.petDesc}</p>
      <SwitchRow icon={<Emoji24Regular />} title={m.petLife} description={m.petLifeDesc} checked={mate.petLife}
        onChange={(petLife) => void update({ teammate: { ...mate, petLife } })} />
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
