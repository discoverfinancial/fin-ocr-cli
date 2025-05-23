/**
 * Copyright (c) 2024 Capital One
*/
/**
 * Runs up to a max number of jobs in parallel.
 *
 * NOTE: The code below is sub-optimal in the sense that less than "max" number of jobs may run concurrently.
 *       For example, suppose we have 3 jobs to run, the max number to run concurrently is 2, and that job 2
 *       completes before job 1.  In this case, we should start job 3 as soon as job 2 completes; however, this
 *       code currently starts job 3 when job 1 completes.
 *       The way to fix this is to use "await Promise.any" over the array of promises so that we recognize when
 *       any of the jobs complete (e.g. job 2 in the example above); however, installing that causes hangs to
 *       occur in tesseract for some reason.  Therefore, do not use "await Promise.any" for now and live with
 *       the sub-optimal degree of concurrency.
 */
export class Queue<T> {

    private iter: () => Promise<T | undefined>;
    private promises: Promise<T | undefined>[] = [];
    private max: number;

    /**
     * Constructor
     * @param iter The iterator which returns the next job to be run
     * @param max The max number of jobs to run concurrently
     */
    constructor(iter: () => Promise<T | undefined>, max: number) {
        this.iter = iter;
        this.max = max;
    }
    
    public async run() {
        for(;;) {
            const r = await this.getNext();
            if (!r) break;
        }
    }

    private async getNext(): Promise<T | undefined> {
        while(this.promises.length < this.max) {
            this.promises.push(this.iter());
        }
        const p = this.promises.shift() as Promise<T | undefined>;
        return await p;
    }

}
