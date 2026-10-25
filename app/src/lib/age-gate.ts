// The 21+ check (Pick interests, Filters): asks for a birthday when the account has none, then unlocks.
import { Alert, Platform } from 'react-native';

import { formatBirthdayInput, parseBirthday } from '@/lib/account';
import { errorText } from '@/lib/backend';
import type { Store } from '@/lib/store';

const TOO_YOUNG = () => Alert.alert('21+ only', 'Nightlife and 21+ shops open up on your 21st birthday.');

function askBirthday(): Promise<string | null> {
  return new Promise((resolve) => {
    if (Platform.OS !== 'ios' || !Alert.prompt) {
      Alert.alert('Add your birthday', 'Add it from Create account to see 21+ deals.');
      resolve(null);
      return;
    }
    Alert.prompt(
      'Add your birthday',
      'MM/DD/YYYY. We need it once to show 21+ deals. It never appears on your profile.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
        {
          text: 'Save',
          onPress: (value?: string) => {
            const iso = parseBirthday(formatBirthdayInput(value ?? ''));
            if (!iso) Alert.alert('That date doesn’t look right', 'Use MM/DD/YYYY, e.g. 03/14/2004.');
            resolve(iso);
          },
        },
      ],
      'plain-text',
      '',
      'number-pad',
    );
  });
}

/** True once 21+ is unlocked. */
export async function verifyAge(store: Store): Promise<boolean> {
  if (store.adultUnlocked) return true;
  try {
    let result = await store.unlockAdult();
    if (result === 'no-birthday') {
      const birthday = await askBirthday();
      if (!birthday) return false;
      await store.setBirthday(birthday);
      result = await store.unlockAdult();
    }
    if (result === 'too-young') TOO_YOUNG();
    return result === 'unlocked';
  } catch (e) {
    Alert.alert('Couldn’t check your age', errorText(e));
    return false;
  }
}
