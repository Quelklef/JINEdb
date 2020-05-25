
import 'fake-indexeddb/auto';
import { newJine, Jine, addStore, addIndex, Store, Index, BoundConnection, Transaction } from '../src/jine';
import { reset } from './shared';

type Post = {
  title: string;
  text: string;
}

interface $$ {
  $posts: Store<Post> & {
    $title: Index<Post, string>;
  };
}


describe('shorthand', () => {

  const migrations = [

    {
      version: 1,

      alterations: [
        addStore<Post>({
          name: 'posts',
          // TODO: would be nice to make these optional,
          //       but perhaps clearer to leave them required...
          encode: x => x,
          decode: x => x as Post,
        }),

        addIndex<Post, string>({
          name: 'title',
          to: 'posts',
          trait: 'title',
        }),
      ],
    },

  ];

  const some_post = {
    title: 'On Bananas',
    text: 'body text',
  }

  function tests(host_name: string, get_host: () => $$): void {

    it(`supports ${host_name}.$store.add and ${host_name}.$store.all`, async () => {
      const host = get_host();
      await host.$posts.add(some_post);
      const posts = await host.$posts.all();
      expect(posts).toEqual([some_post]);
    });

    it(`supports ${host_name}.$store.add and ${host_name}.$store.count`, async () => {
      const host = get_host();
      await host.$posts.add(some_post);
      await host.$posts.add(some_post);
      const count = await host.$posts.count();
      expect(count).toEqual(2);
    });

    it(`supports ${host_name}.$store.add and ${host_name}.$store.clear`, async () => {
      const host = get_host();
      await host.$posts.add(some_post);
      await host.$posts.add(some_post);
      await host.$posts.clear();
      const count = await host.$posts.count();
      expect(count).toEqual(0);
    });

    it(`supports ${host_name}.$store.add and ${host_name}.$store.$index.find`, async () => {
      const host = get_host();
      await host.$posts.add(some_post);
      const got = await host.$posts.$title.find('On Bananas');
      expect(got).toEqual([some_post]);
    });

    it(`supports ${host_name}.$store.add and ${host_name}.$store.$index.all`, async () => {
      const host = get_host();
      await host.$posts.add(some_post);
      const got = await host.$posts.$title.all().delete();
      const count = await host.$posts.count();
      expect(count).toEqual(0);
    });

  }

  // --

  let jine!: Jine<$$>;

  beforeEach(async () => {
    await reset();
    jine = await newJine<$$>('jine', migrations);
  });

  tests('Database', () => jine);

  describe("connection-bound", () => {

    let conn!: $$ & BoundConnection<$$>;

    beforeEach(async () => {
      conn = await jine.newConnection();
    });

    afterEach(async () => {
      conn.close();
    });

    tests('Connection', () => conn);

    describe("transaction-bound", () => {

      let tx!: $$ & Transaction<$$>;

      beforeEach(async () => {
        tx = await conn.newTransaction([conn.$posts], 'rw');
      });

      afterEach(async () => {
        tx.commit();
      });

      tests('Transaction', () => tx);

    });

  });

});
