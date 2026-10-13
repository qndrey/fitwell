/**
 * Single source for what the About screen credits. Third-party package texts come from
 * generated/licenses.json (scripts/build-licenses.ts); dataset details come from each dataset's own metadata.
 */
export interface Credit {
  id: string;
  name: string;
  /** What it is used for, in plain words. */
  use: string;
  license: string;
  licenseUrl?: string;
  url?: string;
  /** The attribution the licence asks us to show. */
  text: string;
}

export const OTHER_CREDITS: Credit[] = [
  {
    id: 'off',
    name: 'Open Food Facts',
    use: 'Packaged-food nutrition, looked up only when you ask (or when a food you logged without nutrition is waiting).',
    license: 'Open Database License 1.0 (database), Database Contents License 1.0 (contents)',
    licenseUrl: 'https://world.openfoodfacts.org/legal',
    url: 'https://world.openfoodfacts.org',
    text: 'Packaged-food data © Open Food Facts contributors, available under the Open Database License (ODbL 1.0); individual contents under the Database Contents License. Foods you choose are saved on this device so they work offline next time. Only the words you typed, or the barcode digits, are ever sent.',
  },
  {
    id: 'compendium',
    name: 'Compendium of Physical Activities',
    use: 'Rounded effort levels (METs) for common activities, used for calorie estimates.',
    license: 'Published reference values; not a copy of the Compendium',
    url: 'https://pacompendium.com',
    text: 'Effort levels are rounded estimates for common activities, following Ainsworth BE, et al. 2011 Compendium of Physical Activities: a second update of codes and MET values. Med Sci Sports Exerc 43(8):1575–1581. Real energy use varies from person to person.',
  },
  {
    id: 'zxing',
    name: 'ZXing-C++',
    use: 'Reads barcodes on devices without a built-in reader (runs on your device as WebAssembly, served by this app).',
    license: 'Apache License 2.0',
    licenseUrl: 'https://github.com/zxing-cpp/zxing-cpp/blob/master/LICENSE',
    url: 'https://github.com/zxing-cpp/zxing-cpp',
    text: 'Contains ZXing-C++ (© its authors), compiled to WebAssembly by zxing-wasm and used through barcode-detector. Licensed under the Apache License, Version 2.0 (full text below).',
  },
];
