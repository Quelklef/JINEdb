
import 'fake-indexeddb/auto';

import { newJine, Jine, addStore, addTraitIndex, Store, Index } from '../src/jine';

type Post = {
  title: string;
  text: string;
}

interface $$ {
  $posts: Store<Post> & {
    $title: Index<Post, string>;
  };
}


describe('End-to-end posts', () => {

  let jine!: Jine<$$>;

  beforeEach(async () => {

    await new Promise(resolve => {
      const req = indexedDB.deleteDatabase('jine');
      req.onsuccess = _event => resolve();
      req.onerror = () => console.log('database deletion error')
      req.onblocked = () => console.log('database deletion blocked');
    });

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

          addTraitIndex<Post, string>({
            to: 'posts',
            name: 'title',
            get: post => post.title,
            unique: true,
          }),

        ],
      },

    ];

    jine = await newJine<$$>('jine', migrations);

  });

  afterEach(async () => {

    jine._idb_db.close();

  });

  const some_post = {
    title: 'my new post',
    text: 'body text',
  }

  it('add/all', async () => {
    await jine.$posts.add(some_post);
    const posts = await jine.$posts.all();
    expect(posts).toEqual([some_post]);
  });

  it('add/count', async () => {
    await jine.$posts.add(some_post);
    await jine.$posts.add(some_post);
    const count = await jine.$posts.count();
    expect(count).toEqual(2);
  });

  it('add/clear', async () => {
    await jine.$posts.add(some_post);
    await jine.$posts.add(some_post);
    await jine.$posts.clear();
    const count = await jine.$posts.count();
    expect(count).toEqual(0);
  });

});
