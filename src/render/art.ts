// Loads the hand-authored SVG assets as textures.
import * as THREE from 'three'
import mouthsUrl from '../../assets/svg/mouths.svg'
import starUrl from '../../assets/svg/star.svg'
import dropletUrl from '../../assets/svg/droplet.svg'
import heartUrl from '../../assets/svg/heart.svg'
import sparkleUrl from '../../assets/svg/sparkle.svg'
import crownUrl from '../../assets/svg/crown.svg'
import cloudUrl from '../../assets/svg/cloud.svg'
import leafUrl from '../../assets/svg/leaf.svg'
import boltUrl from '../../assets/svg/bolt.svg'
import browUrl from '../../assets/svg/brow.svg'

export interface ArtAssets {
  mouths: THREE.Texture
  star: THREE.Texture
  droplet: THREE.Texture
  heart: THREE.Texture
  sparkle: THREE.Texture
  crown: THREE.Texture
  cloud: THREE.Texture
  leaf: THREE.Texture
  bolt: THREE.Texture
  brow: THREE.Texture
}

export async function loadArt(): Promise<ArtAssets> {
  const loader = new THREE.TextureLoader()
  const load = async (url: string) => {
    const t = await loader.loadAsync(url)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return t
  }
  const [mouths, star, droplet, heart, sparkle, crown, cloud, leaf, bolt, brow] =
    await Promise.all([
      load(mouthsUrl), load(starUrl), load(dropletUrl), load(heartUrl),
      load(sparkleUrl), load(crownUrl), load(cloudUrl), load(leafUrl),
      load(boltUrl), load(browUrl),
    ])
  return { mouths, star, droplet, heart, sparkle, crown, cloud, leaf, bolt, brow }
}
