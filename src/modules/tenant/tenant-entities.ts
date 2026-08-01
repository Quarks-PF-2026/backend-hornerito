import { CollectionPoint } from '../collection-point/entities/collection-point.entity';
import { Media } from '../media/entities/media.entity';
import { Need } from '../need/entities/need.entity';
import { Post } from '../post/entities/post.entity';
import { Supply } from '../supply/entities/supply.entity';

/**
 * Entidades que viven en el schema de cada tenant (no en `public`).
 * Cada DataSource de tenant (`TenantConnectionService`) se abre con esta lista;
 * agregar acá toda entidad nueva que se migre a `migrations/tenant/`.
 */
export const TENANT_ENTITIES = [Supply, Need, Post, CollectionPoint, Media];
