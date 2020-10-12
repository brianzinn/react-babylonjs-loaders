import React, { useContext, useState } from 'react';
import { SceneLoader, Scene, Nullable, ISceneLoaderPlugin, ISceneLoaderPluginAsync, AbstractMesh, IParticleSystem, Skeleton, AnimationGroup, SceneLoaderProgressEvent } from '@babylonjs/core';
import { useScene } from 'babylonjs-hook';

import { ILoadedModel, LoadedModel, LoaderStatus } from './LoadedModel';

export type SceneLoaderContextType = {
    updateProgress: (progress: SceneLoaderProgressEvent) => void
    lastProgress?: Nullable<SceneLoaderProgressEvent>
} | undefined;

export const SceneLoaderContext = React.createContext<SceneLoaderContextType>(undefined);

export type SceneLoaderContextProviderProps = {
    startProgress?: SceneLoaderProgressEvent,
    children: React.ReactNode,
}

export const SceneLoaderContextProvider: React.FC<SceneLoaderContextProviderProps> = (props: SceneLoaderContextProviderProps) => {
    const [progress, setProgress] = useState<Nullable<SceneLoaderProgressEvent>>(null);

    return (<SceneLoaderContext.Provider value={{ lastProgress: progress, updateProgress: setProgress }}>
        {props.children}
    </SceneLoaderContext.Provider>);
}

export type SceneLoaderOptions = {
    /**
     * set that all meshes receive shadows.
     * Defaults to false.
     */
    receiveShadows?: boolean

    /**
     * Scale entire model within these square bounds
     * Defaults to no scaling.
     */
    scaleToDimension?: number

    /**
     * Always select root mesh as active.
     * Defaults to false.
     */
    alwaysSelectAsActiveMesh?: boolean

    /**
     * SceneLoader progress events are set on context provider (when available).
     * Defaults to false.
     */
    reportProgress?: boolean

    scene?: Scene

    /**
     * Access to loaded model as soon as it is loaded, so it provides
     * a way to hide or scale the meshes before the first render.
     */
    onModelLoaded?: (loadedModel: ILoadedModel) => void
}

/**
 * This has limited functionality and only works for limited asset types.
 *
 * This is an experimental API and *WILL* change.
 * TODO: function signature is not any.
 */
const useSceneLoaderWithCache = (): (rootUrl: string, sceneFilename: string, pluginExtension?: string, options?: SceneLoaderOptions) => LoadedModel => {
    // we need our own memoized cache. useMemo, useState, etc. fail miserably - throwing a promise forces the component to remount.
    let suspenseCache: Record<string, () => LoadedModel> = {};
    let suspenseScene: Nullable<Scene> = null;

    // let tasksCompletedCache: Record<string, LoadedModel> = {};

    return (rootUrl: string, sceneFilename: string, pluginExtension?: string, options?: SceneLoaderOptions): LoadedModel => {
        const opts: SceneLoaderOptions = options || {};
        const hookScene = useScene();
        if (opts.scene === undefined && hookScene === null) {
            throw new Error('useSceneLoader can only be used inside a Scene component (or pass scene as an option)')
        }

        const scene: Scene = opts.scene || hookScene!

        if (suspenseScene == null) {
            suspenseScene = scene;
        } else {
            if (suspenseScene !== scene) {
                // console.log('new scene detected - clearing useAssetManager cache');
                suspenseCache = {};
                // NOTE: could keep meshes with mesh.serialize and Mesh.Parse
                // Need to research how to do with textures, etc.
                // browser cache should make the load fast in most cases
                // tasksCompletedCache = {};
                suspenseScene = scene;
            }
        }

        const sceneLoaderContext = useContext<SceneLoaderContextType>(SceneLoaderContext);

        const createSceneLoader = (): () => LoadedModel => {
            const taskPromise = new Promise<LoadedModel>((resolve, reject) => {
                let loadedModel = new LoadedModel()

                loadedModel.status = LoaderStatus.Loading

                let loader: Nullable<ISceneLoaderPlugin | ISceneLoaderPluginAsync> = SceneLoader.ImportMesh(
                    undefined,
                    rootUrl,
                    sceneFilename,
                    scene,
                    (meshes: AbstractMesh[], particleSystems: IParticleSystem[], skeletons: Skeleton[], animationGroups: AnimationGroup[]): void => {
                        loadedModel.rootMesh = new AbstractMesh(sceneFilename + "-root-model", scene);
                        if (opts.alwaysSelectAsActiveMesh === true) {
                            loadedModel.rootMesh.alwaysSelectAsActiveMesh = true;
                        }

                        loadedModel.meshes = [];
                        meshes.forEach(mesh => {
                            loadedModel.meshes!.push(mesh);

                            // leave meshes already parented to maintain model hierarchy:
                            if (!mesh.parent) {
                                mesh.parent = loadedModel.rootMesh!;
                            }

                            if (opts.receiveShadows === true) {
                                mesh.receiveShadows = true;
                            }
                        })
                        loadedModel.particleSystems = particleSystems;
                        loadedModel.skeletons = skeletons;
                        loadedModel.animationGroups = animationGroups;

                        loadedModel.status = LoaderStatus.Loaded;

                        if (opts.scaleToDimension) {
                            loadedModel.scaleTo(opts.scaleToDimension);
                        }
                        if (options?.onModelLoaded) {
                            options.onModelLoaded(loadedModel);
                        }
                        resolve(loadedModel);
                    },
                    (event: SceneLoaderProgressEvent): void => {
                        if (opts.reportProgress === true && sceneLoaderContext !== undefined) {
                            sceneLoaderContext!.updateProgress(event);
                        }
                    },
                    (_: Scene, message: string, exception?: any): void => {
                        reject(exception ?? message);
                    },
                    pluginExtension
                )

                if (loader) {
                    loadedModel.loaderName = loader.name
                } else {
                    loadedModel.loaderName = "no loader found"
                }
            });

            let result: LoadedModel;
            let error: Nullable<Error> = null;
            let suspender: Nullable<Promise<void>> = (async () => {
                try {
                    result = await taskPromise;
                } catch (e) {
                    error = e;
                } finally {
                    suspender = null;
                }
            })();

            const getAssets = () => {
                if (suspender) {
                    throw suspender
                };
                if (error !== null) {
                    throw error;
                }

                return result;
            };
            return getAssets;
        }

        const key = `${rootUrl}/${sceneFilename}`;
        if (suspenseCache[key] === undefined) {
            suspenseCache[key] = createSceneLoader();
        }

        return suspenseCache[key]();
    }
}

export const useSceneLoader = useSceneLoaderWithCache();