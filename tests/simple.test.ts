
import 'fake-indexeddb/auto';
import { newJine, Jine, addStore, addIndex, Store, Index, BoundConnection } from '../src/jine';
import { reset } from './shared';

type Post = {
  title: string;
  text: string;
}

interface $$ {
  $posts: Store<Post>;
}


describe('End-to-end simple', () => {

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
      ],
    },

  ];

  let jine!: Jine<$$>;
  let conn!: $$ & BoundConnection<$$>;

  beforeEach(async () => {
    await reset();
    jine = await newJine<$$>('jine', migrations);
    conn = await jine.newConnection();
  });

  afterEach(async () => {
    conn.close();
  });

  const some_post = {
    title: 'my new post',
    text: 'body text',
  }

  it('add/all', async () => {
    await conn.$posts.add(some_post);
    const posts = await conn.$posts.all();
    expect(posts).toEqual([some_post]);
  });

  it('add/count', async () => {
    await conn.$posts.add(some_post);
    await conn.$posts.add(some_post);
    const count = await conn.$posts.count();
    expect(count).toEqual(2);
  });

  it('add/clear', async () => {
    await conn.$posts.add(some_post);
    await conn.$posts.add(some_post);
    await conn.$posts.clear();
    const count = await conn.$posts.count();
    expect(count).toEqual(0);
  });

});
