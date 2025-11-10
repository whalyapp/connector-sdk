export interface StateHolder {
    state?: any
}

export interface StateProvider {
    getState(): Promise<StateHolder>;
    writeState(state: string): Promise<void>;
}