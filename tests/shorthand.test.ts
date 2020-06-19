
import 'fake-indexeddb/auto';
import { Database, Store, Index, Connection, Transaction } from '../src/jine';
import { reset } from './shared';

type Post = {
  title: string;
  text: string;
}

interface $$ {
  posts: Store<Post> & {
    by: {
      title: Index<Post, string>;
    };
  };
}


describe('shorthand', () => {

  const some_post = {
    title: 'On Bananas',
    text: 'body text',
  }

  function tests(host_name: string, get_host: () => { $: $$ }): void {

    it(`supports ${host_name}.$.{store}.add and ${host_name}.$.{store}.array`, async () => {
      const host = get_host();
      await host.$.posts.add(some_post);
      const posts = await host.$.posts.array();
      expect(posts).toEqual([some_post]);
    });

    it(`supports ${host_name}.$.{store}.add and ${host_name}.$.{store}.count`, async () => {
      const host = get_host();
      await host.$.posts.add(some_post);
      await host.$.posts.add(some_post);
      const count = await host.$.posts.count();
      expect(count).toEqual(2);
    });

    it(`supports ${host_name}.$.{store}.add and ${host_name}.$.{store}.clear`, async () => {
      const host = get_host();
      await host.$.posts.add(some_post);
      await host.$.posts.add(some_post);
      await host.$.posts.clear();
      const count = await host.$.posts.count();
      expect(count).toEqual(0);
    });

    it(`supports ${host_name}.$.{store}.add and ${host_name}.$.{store}.by.{index}.find`, async () => {
      const host = get_host();
      await host.$.posts.add(some_post);
      const got = await host.$.posts.by.title.find('On Bananas');
      expect(got).toEqual([some_post]);
    });

  }

  // --

  let jine!: Database<$$>;

  beforeEach(async () => {
    reset();
    jine = new Database<$$>('jine');
    await jine.upgrade(1, async (genuine: boolean, tx) => {
      const posts = tx.addStore<Post>('posts');
      posts.addIndex<string>('title', '.title');
    });
  });

  tests('Database', () => jine);

  describe("connection-bound", () => {

    let conn!: Connection<$$>;

    beforeEach(async () => {
      conn = await jine.newConnection();
    });

    afterEach(async () => {
      conn.close();
    });

    tests('Connection', () => conn);

    describe("transaction-bound", () => {

      let tx!: Transaction<$$>;

      beforeEach(async () => {
        // TODO: fix this
        const tx_k = await conn.newTransaction([conn.$.posts], 'rw');
        tx = await tx_k.value;
      });

      afterEach(async () => {
        tx.commit();
      });

      tests('Transaction', () => tx);

    });

  });

});
