<?php get_header(); ?><main id="conteudo" class="page-main"><div class="container"><?php if (have_posts()) { while (have_posts()) { the_post(); the_content(); } } ?></div></main><?php get_footer(); ?>

