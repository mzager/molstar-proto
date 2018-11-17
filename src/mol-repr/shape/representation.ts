/**
 * Copyright (c) 2018 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { Task } from 'mol-task'
import { RenderObject, createMeshRenderObject, MeshRenderObject } from 'mol-gl/render-object';
import { Representation, RepresentationContext } from '../representation';
import { Loci, EmptyLoci, isEveryLoci } from 'mol-model/loci';
import { ValueCell } from 'mol-util';
import { Shape } from 'mol-model/shape';
import { OrderedSet, Interval } from 'mol-data/int';
import { ParamDefinition as PD } from 'mol-util/param-definition';
import { Mesh } from 'mol-geo/geometry/mesh/mesh';
import { createIdentityTransform } from 'mol-geo/geometry/transform-data';
import { createRenderableState } from 'mol-geo/geometry/geometry';
import { PickingId } from 'mol-geo/geometry/picking';
import { MarkerAction, applyMarkerAction } from 'mol-geo/geometry/marker-data';
import { LocationIterator } from 'mol-geo/util/location-iterator';
import { createTheme } from 'mol-theme/theme';
import { Subject } from 'rxjs';

export interface ShapeRepresentation<P extends ShapeParams> extends Representation<Shape, P> { }

export const ShapeParams = {
    ...Mesh.Params,
    // TODO
    // colorTheme: PD.Select<ColorThemeName>('Color Theme', '', 'shape-group', ColorThemeOptions)
}
export type ShapeParams = typeof ShapeParams

export function ShapeRepresentation<P extends ShapeParams>(): ShapeRepresentation<P> {
    let version = 0
    const updated = new Subject<number>()
    const renderObjects: RenderObject[] = []
    let _renderObject: MeshRenderObject | undefined
    let _shape: Shape
    let currentProps: PD.Values<P> = PD.getDefaultValues(ShapeParams) as PD.Values<P>
    let currentParams: P

    function createOrUpdate(ctx: RepresentationContext, props: Partial<PD.Values<P>> = {}, shape?: Shape) {
        currentProps = Object.assign({}, currentProps, props)
        if (shape) _shape = shape

        return Task.create('ShapeRepresentation.create', async runtime => {
            renderObjects.length = 0

            if (!_shape) return

            const mesh = _shape.mesh
            const locationIt = ShapeGroupIterator.fromShape(_shape)
            const theme = createTheme(ctx, currentProps, {})
            const transform = createIdentityTransform()

            const values = await Mesh.createValues(runtime, mesh, transform, locationIt, theme, currentProps)
            const state = createRenderableState(currentProps)

            _renderObject = createMeshRenderObject(values, state)
            renderObjects.push(_renderObject)
            updated.next(version++)
        });
    }

    return {
        label: 'Shape mesh',
        updated,
        get renderObjects () { return renderObjects },
        get params () { return currentParams },
        get props () { return currentProps },
        createOrUpdate,
        getLoci(pickingId: PickingId) {
            const { objectId, groupId } = pickingId
            if (_renderObject && _renderObject.id === objectId) {
                return Shape.Loci(_shape, [{ ids: OrderedSet.ofSingleton(groupId) }])
            }
            return EmptyLoci
        },
        mark(loci: Loci, action: MarkerAction) {
            if (!_renderObject) return false
            const { tMarker } = _renderObject.values
            let changed = false
            if (isEveryLoci(loci)) {
                if (applyMarkerAction(tMarker.ref.value.array, 0, _shape.mesh.triangleCount, action)) changed = true
            } else if (Shape.isLoci(loci)) {
                for (const g of loci.groups) {
                    if (Interval.is(g.ids)) {
                        const start = Interval.start(g.ids)
                        const end = Interval.end(g.ids)
                        if (applyMarkerAction(tMarker.ref.value.array, start, end, action)) changed = true
                    } else {
                        for (let i = 0, _i = g.ids.length; i < _i; i++) {
                            const idx = g.ids[i];
                            if (applyMarkerAction(tMarker.ref.value.array, idx, idx + 1, action)) changed = true
                        }
                    }
                }
            }
            if (changed) {
                ValueCell.update(tMarker, tMarker.ref.value)
            }
            return changed
        },
        setVisibility(value: boolean) {
            renderObjects.forEach(ro => ro.state.visible = value)
        },
        setPickable(value: boolean) {
            renderObjects.forEach(ro => ro.state.pickable = value)
        },
        destroy() {
            // TODO
            renderObjects.length = 0
            _renderObject = undefined
        }
    }
}

export namespace ShapeGroupIterator {
    export function fromShape(shape: Shape): LocationIterator {
        const { groupCount } = shape
        const instanceCount = 1
        const location = Shape.Location(shape)
        const getLocation = (groupIndex: number) => {
            location.group = groupIndex
            return location
        }
        return LocationIterator(groupCount, instanceCount, getLocation)
    }
}